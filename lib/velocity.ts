// lib/velocity.ts
// Pure domain logic: no React, no storage. Every function here is deterministic
// given its inputs, so it can be unit-tested and reused server-side later.

import {
  TASK_IDS,
  type ClockTime,
  type DailyLog,
  type DateKey,
  type ExecutionGrade,
  type ExecutionScore,
  type StreakMetrics,
  type UserProfile,
  type VelocityState,
} from "@/types/velocity";
import { pauseAllTasks, runningTask } from "@/lib/tasks";

// ─── Dates ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateKey(d: Date = new Date()): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Whole calendar days from a to b (b - a). DST-safe. */
export function daysBetween(a: DateKey, b: DateKey): number {
  const ms = Date.UTC(...ymd(b)) - Date.UTC(...ymd(a));
  return Math.round(ms / 86_400_000);
}

function ymd(key: DateKey): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m - 1, d];
}

export function clockToMinutes(t: ClockTime): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** A logged moment, in the phone's own 12/24-hour style ("5:35 AM" or "05:35"). */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A clock setting ("HH:MM") in the same style as formatClock, so every time on screen matches. */
export function displayClock(clock: ClockTime): string {
  const [h, m] = clock.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Minutes since midnight → "HH:MM". Wraps around midnight. */
export function minutesToClock(totalMinutes: number): ClockTime {
  const m = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// ─── Factories ───────────────────────────────────────────────────────────────

export function createDefaultProfile(today: DateKey = toDateKey()): UserProfile {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
    name: "Operator",
    wakeTarget: "05:30",
    wakeGraceMinutes: 15,
    deepWorkTargetMinutes: 90,
    startDate: today,
    createdAt: new Date().toISOString(),
  };
}

export function createInitialState(): VelocityState {
  return { version: 1, profile: createDefaultProfile(), logs: {} };
}

export function createEmptyLog(date: DateKey): DailyLog {
  return {
    date,
    wake: null,
    gym: null,
    deepWork: { sessions: [], totalMinutes: 0 },
    completed: { wake: false, gym: false, deepWork: false },
  };
}

// ─── Task evaluation ─────────────────────────────────────────────────────────

/** The wake button unlocks up to this many minutes before target. */
export const WAKE_OPENS_EARLY_MINUTES = 90;
/** ...but never before 4 AM, so a tap on the way to bed at 1 AM can't count as waking up. */
const EARLIEST_WINDOW_MINUTES = 4 * 60;

export type WakeWindowState = "early" | "open" | "closed";

/** Minutes after midnight when today's wake window opens. One rule, shared by the button, the scoring and the coach. */
export function wakeWindowOpensAt(profile: UserProfile): number {
  const target = clockToMinutes(profile.wakeTarget);
  // A target before 4 AM opens at the target itself.
  return Math.max(target - WAKE_OPENS_EARLY_MINUTES, Math.min(target, EARLIEST_WINDOW_MINUTES));
}

/** Minutes after midnight when the window closes (target + grace). */
export function wakeWindowClosesAt(profile: UserProfile): number {
  return clockToMinutes(profile.wakeTarget) + profile.wakeGraceMinutes;
}

/** Where `at` falls relative to today's wake window. */
export function wakeWindowState(profile: UserProfile, at: Date): WakeWindowState {
  const nowMin = at.getHours() * 60 + at.getMinutes();
  if (nowMin < wakeWindowOpensAt(profile)) return "early";
  if (nowMin <= wakeWindowClosesAt(profile)) return "open";
  return "closed";
}

/** Evaluate a wake log at the moment of logging. On time means inside the window, nothing else. */
export function evaluateWake(profile: UserProfile, at: Date) {
  const minutesOff = at.getHours() * 60 + at.getMinutes() - clockToMinutes(profile.wakeTarget);
  return { minutesOff, onTime: wakeWindowState(profile, at) === "open" };
}

export function closedSessionMinutes(log: DailyLog): number {
  return log.deepWork.sessions.reduce((sum, s) => {
    if (!s.endedAt) return sum;
    return sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60_000;
  }, 0);
}

export function activeSession(log: DailyLog) {
  return log.deepWork.sessions.find((s) => s.endedAt === null) ?? null;
}

/**
 * Re-derive `completed` + `totalMinutes` from raw logs. Call after every mutation.
 * The day keeps the deep work target it was first recorded with, so changing
 * the target later never rewrites history.
 */
export function finalizeLog(log: DailyLog, profile: UserProfile): DailyLog {
  const totalMinutes = Math.floor(closedSessionMinutes(log));
  const deepWorkTarget = log.deepWorkTarget ?? profile.deepWorkTargetMinutes;
  return {
    ...log,
    deepWorkTarget,
    deepWork: { ...log.deepWork, totalMinutes },
    completed: {
      // A late wake is logged but NOT executed. No partial credit.
      wake: log.wake?.onTime === true,
      gym: log.gym !== null,
      deepWork: totalMinutes >= deepWorkTarget,
    },
  };
}

/** The deep work target a given day is judged by. */
export function deepWorkTargetFor(log: DailyLog | undefined, profile: UserProfile): number {
  return log?.deepWorkTarget ?? profile.deepWorkTargetMinutes;
}

/**
 * A session still running this soon after midnight was live when the day
 * turned over (the app was open), so it carries on into the new day.
 * Anything older means the app was closed mid-session: it just ends.
 */
const CARRY_OVER_MIDNIGHT_MS = 5 * 60_000;

/**
 * Close deep work sessions left running on past days (the tab stayed open
 * past midnight, or the app was closed mid-session). Each one ends at the
 * earlier of `now` and the last millisecond of its own day, so the minutes
 * are credited to the day they were worked. If the day turned over while the
 * session was live, a new session continues from midnight today.
 */
export function closeStaleSessions(state: VelocityState, today: DateKey, now: Date): VelocityState {
  let changed = false;
  const logs = { ...state.logs };
  const midnight = fromDateKey(today);
  let continueFromMidnight = false;

  for (const [key, log] of Object.entries(state.logs)) {
    const openSession = log.deepWork.sessions.some((s) => s.endedAt === null);
    if (key >= today || (!openSession && !runningTask(log))) continue;
    const endOfDay = fromDateKey(key);
    endOfDay.setHours(23, 59, 59, 999);
    const endAt = new Date(Math.min(now.getTime(), endOfDay.getTime()));
    const end = endAt.toISOString();
    logs[key] = finalizeLog(
      pauseAllTasks(
        {
          ...log,
          deepWork: {
            ...log.deepWork,
            sessions: log.deepWork.sessions.map((s) => (s.endedAt === null ? { ...s, endedAt: end } : s)),
          },
        },
        endAt,
      ),
      state.profile,
    );
    if (openSession && key === addDays(today, -1) && now.getTime() - midnight.getTime() <= CARRY_OVER_MIDNIGHT_MS) {
      continueFromMidnight = true;
    }
    changed = true;
  }

  if (continueFromMidnight) {
    const current = logs[today] ?? createEmptyLog(today);
    if (!current.deepWork.sessions.some((s) => s.endedAt === null)) {
      logs[today] = finalizeLog(
        {
          ...current,
          deepWork: {
            ...current.deepWork,
            sessions: [...current.deepWork.sessions, { startedAt: midnight.toISOString(), endedAt: null }],
          },
        },
        state.profile,
      );
    }
  }
  return changed ? { ...state, logs } : state;
}

// ─── Changing the standard ───────────────────────────────────────────────────
// The wake target, grace period and deep work target are the rules a day is
// judged by. Once a day is underway they can't be bent to rescue it: a change
// made then is saved as pending and starts tomorrow.

export type Standard = Pick<UserProfile, "wakeTarget" | "wakeGraceMinutes" | "deepWorkTargetMinutes">;
export const STANDARD_KEYS = ["wakeTarget", "wakeGraceMinutes", "deepWorkTargetMinutes"] as const;

/**
 * The standard can change today only while today is untouched (nothing logged) and either the
 * wake window hasn't opened yet or this is the user's first day: someone who installs in the
 * afternoon can set their wake time and use the app the same day.
 */
export function canChangeStandardToday(log: DailyLog | undefined, profile: UserProfile, now: Date): boolean {
  const touched =
    !!log &&
    (log.wake !== null ||
      log.gym !== null ||
      log.deepWork.sessions.length > 0 ||
      (log.tasks ?? []).some((t) => t.spentSeconds > 0 || t.startedAt !== null));
  if (touched) return false;
  return wakeWindowState(profile, now) === "early" || profile.startDate === toDateKey(now);
}

/** The standard that will apply tomorrow: today's plus any pending change. */
export function upcomingStandard(profile: UserProfile): UserProfile {
  if (!profile.pending) return profile;
  const { from: _from, ...patch } = profile.pending;
  return { ...profile, ...patch };
}

/** Apply a standard change now, or queue it for tomorrow if today is already underway. */
export function changeStandard(
  state: VelocityState,
  patch: Partial<Standard>,
  today: DateKey,
  now: Date,
): VelocityState {
  const { profile } = state;
  if (canChangeStandardToday(state.logs[today], profile, now)) {
    const next = { ...profile, ...patch, pending: null };
    const log = state.logs[today];
    // An untouched day adopts the new target (drop the one it was stamped with).
    const fresh = log ? finalizeLog({ ...log, deepWorkTarget: undefined }, next) : undefined;
    return { ...state, profile: next, logs: fresh ? { ...state.logs, [today]: fresh } : state.logs };
  }
  // Queue for tomorrow, dropping anything that matches the current standard.
  const { from: _oldFrom, ...queued } = profile.pending ?? { from: "" };
  const merged: Partial<Standard> = { ...queued, ...patch };
  for (const k of STANDARD_KEYS) if (merged[k] === profile[k]) delete merged[k];
  const pending = Object.keys(merged).length ? { ...merged, from: addDays(today, 1) } : null;
  return { ...state, profile: { ...profile, pending } };
}

/** Promote a pending standard once its day arrives. */
export function applyPendingStandard(state: VelocityState, today: DateKey): VelocityState {
  const pending = state.profile.pending;
  if (!pending || pending.from > today) return state;
  const { from: _from, ...patch } = pending;
  return { ...state, profile: { ...state.profile, ...patch, pending: null } };
}

/** Everything that has to happen when the app opens or the day turns over. */
export function rollover(state: VelocityState, today: DateKey, now: Date): VelocityState {
  return applyPendingStandard(closeStaleSessions(state, today, now), today);
}

export function completedCount(log: DailyLog | undefined): number {
  if (!log) return 0;
  return TASK_IDS.filter((id) => log.completed[id]).length;
}

export function isExecuted(log: DailyLog | undefined): boolean {
  return completedCount(log) === TASK_IDS.length;
}

// ─── Streaks ─────────────────────────────────────────────────────────────────
// Streaks are derived from logs, never stored. That makes undo safe and means
// a missed day can't be "patched" by editing a counter.

function runEndingAt(logs: Record<DateKey, DailyLog>, end: DateKey): number {
  let count = 0;
  let cursor = end;
  while (isExecuted(logs[cursor])) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function computeStreak(state: VelocityState, today: DateKey): StreakMetrics {
  const { logs, profile } = state;
  const yesterday = addDays(today, -1);

  // Today still open: the streak stands on yesterday. Miss yesterday → zero.
  const current = isExecuted(logs[today])
    ? runEndingAt(logs, today)
    : runEndingAt(logs, yesterday);

  const yesterdayCounts = yesterday >= profile.startDate;
  const lostStreak =
    yesterdayCounts && !isExecuted(logs[yesterday]) ? runEndingAt(logs, addDays(yesterday, -1)) : 0;

  let longest = 0;
  let run = 0;
  let prev: DateKey | null = null;
  let totalExecutedDays = 0;
  for (const key of Object.keys(logs).sort()) {
    if (!isExecuted(logs[key])) {
      run = 0;
      prev = key;
      continue;
    }
    totalExecutedDays++;
    run = prev !== null && addDays(prev, 1) === key && isExecuted(logs[prev]) ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = key;
  }

  return { current, longest, totalExecutedDays, lostStreak };
}

// ─── Execution score ─────────────────────────────────────────────────────────

/**
 * Completed / possible tasks over the last `window` finished days.
 * Today only counts once it's fully executed, so an in-progress day never
 * drags the score down at 6 AM. Returns null when there's no finished day yet.
 */
function rollingScore(state: VelocityState, today: DateKey, window: number): number | null {
  const end = isExecuted(state.logs[today]) ? today : addDays(today, -1);
  const first = addDays(end, -(window - 1));
  const start = first > state.profile.startDate ? first : state.profile.startDate;
  const days = daysBetween(start, end) + 1;
  if (days <= 0) return null;

  let done = 0;
  for (let i = 0; i < days; i++) done += completedCount(state.logs[addDays(start, i)]);
  return Math.round((done / (days * TASK_IDS.length)) * 100);
}

export function gradeFor(score: number | null): ExecutionGrade {
  if (score === null) return "NEW";
  if (score >= 90) return "ELITE";
  if (score >= 70) return "ON TRACK";
  if (score >= 40) return "SLIPPING";
  return "FAILING";
}

export function computeScore(state: VelocityState, today: DateKey): ExecutionScore {
  const todayScore = Math.round((completedCount(state.logs[today]) / TASK_IDS.length) * 100);
  const rolling7 = rollingScore(state, today, 7);
  return {
    today: todayScore,
    rolling7,
    rolling30: rollingScore(state, today, 30),
    grade: gradeFor(rolling7),
  };
}
