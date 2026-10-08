// lib/coach.ts
// Rule-based coach. Reads the user's own logs and the clock, returns one
// directive for right now plus the patterns holding him back.
// Deterministic on purpose: no made-up advice, works offline, easy to test.
// An LLM coach can later sit on top of this and use CoachReport as its context.

import type { DailyLog, DateKey, StreakMetrics, TaskId, VelocityState } from "@/types/velocity";
import {
  activeSession,
  addDays,
  createEmptyLog,
  deepWorkTargetFor,
  displayClock,
  fromDateKey,
  isExecuted,
  minutesToClock,
  upcomingStandard,
  wakeWindowClosesAt,
  wakeWindowOpensAt,
} from "@/lib/velocity";
import { lightsOut } from "@/lib/playbook";

export type DirectiveTone = "push" | "urgent" | "win" | "reset" | "rest";

export interface CoachDirective {
  tone: DirectiveTone;
  headline: string;
  body: string;
  /** The task the user should act on now, if any. The UI turns this into a button. */
  focus: TaskId | null;
}

export type InsightTone = "warn" | "win" | "info";

export interface CoachInsight {
  id: string;
  tone: InsightTone;
  title: string;
  body: string;
}

export interface CoachMilestone {
  target: number;
  remaining: number;
  note: string;
}

export interface CoachReport {
  directive: CoachDirective;
  insights: CoachInsight[];
  milestone: CoachMilestone | null;
}

const TASK_NAMES: Record<TaskId, string> = {
  wake: "the wake-up",
  gym: "training",
  deepWork: "deep work",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MILESTONES: { days: number; note: string }[] = [
  { days: 3, note: "Three days in a row proves you can do it. Now prove it's not a fluke." },
  { days: 7, note: "One full week. Most people quit before this." },
  { days: 21, note: "Three weeks. The routine starts running without negotiation." },
  { days: 30, note: "A full month of execution." },
  { days: 66, note: "66 days was the median time for a daily behavior to become automatic in a well-known UCL habit study." },
  { days: 100, note: "Triple digits." },
  { days: 180, note: "Six months. This is who you are now." },
  { days: 365, note: "One year without a missed day." },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────


function fmtMinutes(total: number): string {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Deep work minutes including a running session. */
function deepMinutesNow(log: DailyLog, now: Date): number {
  const live = activeSession(log);
  const liveMin = live ? (now.getTime() - new Date(live.startedAt).getTime()) / 60_000 : 0;
  return log.deepWork.totalMinutes + liveMin;
}

/** Past days the user was accountable for, oldest first, excluding today. */
function pastDays(state: VelocityState, today: DateKey, window: number): DateKey[] {
  const days: DateKey[] = [];
  for (let i = window; i >= 1; i--) {
    const d = addDays(today, -i);
    if (d >= state.profile.startDate) days.push(d);
  }
  return days;
}

// ─── Directive: the one thing to do right now ────────────────────────────────

export function getDirective(state: VelocityState, today: DateKey, now: Date, streak: StreakMetrics): CoachDirective {
  const { profile } = state;
  const log = state.logs[today] ?? createEmptyLog(today);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const windowOpen = wakeWindowOpensAt(profile);
  const windowClose = wakeWindowClosesAt(profile);
  // Tonight's lights-out serves tomorrow's wake target, including a change that starts tomorrow.
  const bed = displayClock(lightsOut(upcomingStandard(profile)));
  const minutesLeft = 1440 - nowMin;
  const deepDone = log.completed.deepWork;
  const deepLeft = Math.max(0, deepWorkTargetFor(log, profile) - deepMinutesNow(log, now));
  const session = activeSession(log);

  if (isExecuted(log)) {
    return {
      tone: "win",
      headline: "Day executed.",
      body: `Streak is ${streak.current}. Now protect tomorrow: lights out by ${bed}, gym bag by the door, tomorrow's deep work task written down.`,
      focus: null,
    };
  }

  if (session) {
    if (deepLeft <= 0) {
      return {
        tone: "win",
        headline: "Target hit. Stop and lock it in.",
        body: "If you're in flow, keep going—it all counts once you stop the timer. Either way, hit stop to finalize the session.",
        focus: null,
      };
    }
    return {
      tone: "push",
      headline: "Stay in the block.",
      body: `${fmtMinutes(deepLeft)} to target. Phone stays in the other room. Nothing gets checked until the timer clears.`,
      focus: null,
    };
  }

  // Small hours before the window: the only job is sleep.
  if (!log.wake && nowMin < windowOpen) {
    return {
      tone: "rest",
      headline: "Go to sleep.",
      body: `Your window opens at ${displayClock(minutesToClock(windowOpen))}. Every minute awake now is a minute you'll pay for at the alarm.`,
      focus: null,
    };
  }

  if (!log.wake && nowMin <= windowClose) {
    return {
      tone: "urgent",
      headline: "Feet on the floor.",
      body: `Window closes at ${displayClock(minutesToClock(windowClose))}. Stand up, log it, then get outside light within the hour.`,
      focus: "wake",
    };
  }

  // The day can no longer count. Say so, then redirect to the bigger goal.
  const wakeLost = (log.wake && !log.wake.onTime) || (!log.wake && nowMin > windowClose);
  const deepLost = !deepDone && deepLeft > minutesLeft;
  if (wakeLost || deepLost) {
    const reason = wakeLost
      ? "The wake-up window is gone, so today won't count toward the streak."
      : `There isn't enough time left for ${fmtMinutes(deepLeft)} of deep work, so today won't count toward the streak.`;
    const next: TaskId | null = !log.gym ? "gym" : !deepDone && !deepLost ? "deepWork" : null;
    return {
      tone: "reset",
      headline: "Don't let one miss become two.",
      body: next
        ? `${reason} Train and work anyway. A missed day is a setback; a zero day is the start of a pattern. Lights out by ${bed}.`
        : `${reason} Finish what you can, then set up tomorrow: lights out by ${bed}, alarm across the room.`,
      focus: next,
    };
  }

  // Time pressure on deep work.
  if (!deepDone && deepLeft + 60 > minutesLeft) {
    return {
      tone: "urgent",
      headline: "Start deep work now.",
      body: `You need ${fmtMinutes(deepLeft)} and have ${fmtMinutes(minutesLeft)} before midnight. No more buffer.`,
      focus: "deepWork",
    };
  }

  // Normal flow: deep work first in the morning while the mind is fresh, gym otherwise.
  if (!deepDone && (nowMin < 12 * 60 || log.gym)) {
    return {
      tone: "push",
      headline: log.deepWork.sessions.length ? "Finish the block." : "Start the deep work block.",
      body: `${fmtMinutes(deepLeft)} to go. One task, one window, phone in another room. Hit start before you open anything else.`,
      focus: "deepWork",
    };
  }

  return {
    tone: "push",
    headline: "Get to the gym.",
    body: "Bag, keys, door. Check in the moment you arrive. Getting there is the hard part; the session takes care of itself.",
    focus: "gym",
  };
}

// ─── Insights: patterns in the last few weeks ────────────────────────────────

const WEAK_LINK_FIX: Record<TaskId, (bed: string) => string> = {
  wake: (bed) => `Fix the night, not the morning. Lights out by ${bed}, phone charging outside the bedroom.`,
  gym: () => "Decide time and session the night before and pack the bag. Train at the same time daily so it stops being a decision.",
  deepWork: () => "Schedule the block at a fixed time, before the day fills up. Pick the task the night before.",
};

export function getInsights(state: VelocityState, today: DateKey, streak: StreakMetrics): CoachInsight[] {
  const days14 = pastDays(state, today, 14);
  const insights: CoachInsight[] = [];
  const bed = displayClock(lightsOut(upcomingStandard(state.profile)));

  if (streak.lostStreak > 0) {
    insights.push({
      id: "never-miss-twice",
      tone: "warn",
      title: "Never miss twice.",
      body: `You lost a ${streak.lostStreak}-day streak. One miss barely dents a habit. Two in a row is how routines die. Execute today.`,
    });
  }

  if (days14.length < 3) {
    insights.push({
      id: "baseline",
      tone: "info",
      title: "Building your baseline.",
      body: `Patterns show up after 3 logged days. You have ${days14.length}. Until then, follow the protocol on each task.`,
    });
    return insights.slice(0, 3);
  }

  // Weak link: lowest completion rate over the last 14 days.
  const rates = (["wake", "gym", "deepWork"] as TaskId[]).map((id) => {
    const done = days14.filter((d) => state.logs[d]?.completed[id]).length;
    return { id, done, rate: done / days14.length };
  });
  const weakest = [...rates].sort((a, b) => a.rate - b.rate)[0];
  if (weakest.rate < 0.8) {
    insights.push({
      id: "weak-link",
      tone: "warn",
      title: `Weak link: ${TASK_NAMES[weakest.id]}.`,
      body: `Executed ${weakest.done} of the last ${days14.length} days. ${WEAK_LINK_FIX[weakest.id](bed)}`,
    });
  }

  // Wake drift over the last 7 logged mornings.
  const wakes = pastDays(state, today, 7)
    .map((d) => state.logs[d]?.wake)
    .filter((w): w is NonNullable<typeof w> => !!w);
  if (wakes.length >= 3) {
    const avg = wakes.reduce((s, w) => s + w.minutesOff, 0) / wakes.length;
    if (avg > state.profile.wakeGraceMinutes / 2) {
      insights.push({
        id: "wake-drift",
        tone: "warn",
        title: "Your wake-up is drifting.",
        body: `You're averaging ${Math.round(avg)}m after target this week. Move lights-out earlier before the window starts closing on you.`,
      });
    } else if (avg <= -10) {
      insights.push({
        id: "wake-early",
        tone: "win",
        title: "You're beating the alarm.",
        body: `Averaging ${Math.abs(Math.round(avg))}m before target this week. Consider moving the target earlier.`,
      });
    }
  }

  // Weekday weak spot over 4 weeks.
  const days28 = pastDays(state, today, 28);
  const misses = new Map<number, { missed: number; total: number }>();
  for (const d of days28) {
    const wd = fromDateKey(d).getDay();
    const m = misses.get(wd) ?? { missed: 0, total: 0 };
    m.total++;
    if (!isExecuted(state.logs[d])) m.missed++;
    misses.set(wd, m);
  }
  const worstDay = [...misses.entries()]
    .filter(([, m]) => m.missed >= 2 && m.missed / m.total >= 0.5)
    .sort((a, b) => b[1].missed - a[1].missed)[0];
  if (worstDay) {
    const [wd, m] = worstDay;
    insights.push({
      id: "weekday",
      tone: "warn",
      title: `${WEEKDAYS[wd]}s are your weak day.`,
      body: `Missed ${m.missed} of the last ${m.total}. Plan the night before every ${WEEKDAYS[wd]}: alarm, bag, deep work task.`,
    });
  }

  // Fragmented deep work.
  const dwDays = days14.map((d) => state.logs[d]).filter((l): l is DailyLog => !!l && l.deepWork.sessions.length > 0);
  if (dwDays.length >= 3) {
    const avgSessions = dwDays.reduce((s, l) => s + l.deepWork.sessions.length, 0) / dwDays.length;
    if (avgSessions >= 3) {
      insights.push({
        id: "fragmented",
        tone: "warn",
        title: "Your deep work is fragmented.",
        body: `${avgSessions.toFixed(1)} sessions a day on average. Aim for one or two long blocks; every restart costs focus.`,
      });
    }
  }

  // Clean record.
  if (insights.length === 0 && rates.every((r) => r.rate === 1)) {
    insights.push({
      id: "clean",
      tone: "win",
      title: "Clean record.",
      body: `Every task, every day for ${days14.length} days. Raise the bar: earlier target or a longer deep work block.`,
    });
  }

  return insights.slice(0, 3);
}

// ─── Milestones ──────────────────────────────────────────────────────────────

export function getMilestone(streak: StreakMetrics): CoachMilestone | null {
  const next = MILESTONES.find((m) => m.days > streak.current);
  if (!next) return null;
  return { target: next.days, remaining: next.days - streak.current, note: next.note };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function getCoachReport(
  state: VelocityState,
  today: DateKey,
  now: Date,
  streak: StreakMetrics,
): CoachReport {
  return {
    directive: getDirective(state, today, now, streak),
    insights: getInsights(state, today, streak),
    milestone: getMilestone(streak),
  };
}
