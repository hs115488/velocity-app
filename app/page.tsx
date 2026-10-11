"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronRight, Settings } from "lucide-react";
import { UNDO_WINDOW_MS, useVelocity } from "@/hooks/use-velocity";
import { cancelTaskAlarm, isNative, scheduleTaskAlarm, tapLight, tapSuccess } from "@/lib/native";
import { nextTask, runningTask, tasksOf, taskRemaining } from "@/lib/tasks";
import { TaskList } from "@/components/task-list";
import { Onboarding } from "@/components/onboarding";
import { isPro, trialAvailable, trialEndsSoon } from "@/lib/billing";
import { lightsOut } from "@/lib/playbook";
import { DayShare } from "@/components/day-share";
import { focusEnabled, runFocus } from "@/lib/focus";
import { getCoachReport, type DirectiveTone, type InsightTone } from "@/lib/coach";
import {
  activeSession,
  addDays,
  completedCount,
  formatClock,
  formatDuration,
  fromDateKey,
  isExecuted,
  isWakeSpillover,
  wakeWindowState,
  deepWorkTargetFor,
  displayClock,
  minutesToClock,
  upcomingStandard,
  wakeWindowClosesAt,
  wakeWindowOpensAt,
} from "@/lib/velocity";
import type { TaskId } from "@/types/velocity";

// ─── Helpers ─────────────────────────────────────────────────────────────────


/** The hook stores loggedAt / checkedInAt; older types call it `at`. Accept either. */
function stampOf(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { loggedAt?: string; checkedInAt?: string; at?: string };
  return e.loggedAt ?? e.checkedInAt ?? e.at ?? null;
}

const TONE: Record<DirectiveTone, { label: string; dot: string; soft: string; text: string }> = {
  push: { label: "Next move", dot: "bg-accent", soft: "bg-accent-soft", text: "text-accent" },
  urgent: { label: "Urgent", dot: "bg-bad", soft: "bg-bad-soft", text: "text-bad" },
  win: { label: "Locked in", dot: "bg-good", soft: "bg-good-soft", text: "text-good" },
  reset: { label: "Reset", dot: "bg-amber", soft: "bg-amber-soft", text: "text-amber" },
  rest: { label: "Recover", dot: "bg-calm", soft: "bg-calm-soft", text: "text-calm" },
};

const INSIGHT_DOT: Record<InsightTone, string> = { warn: "bg-amber", win: "bg-good", info: "bg-calm" };

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

// ─── Small building blocks ───────────────────────────────────────────────────

function SectionLabel({ index, children }: { index: string; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 px-1 pb-3">
      <span className="font-[family-name:var(--font-display)] text-[20px] italic leading-none text-accent">{index}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </h2>
  );
}

function DayDial({ wake, gym, deep }: { wake: boolean; gym: boolean; deep: boolean }) {
  const size = 132;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = c * (100 / 360);
  const arcs = [
    { on: wake, color: "var(--dial-wake)" },
    { on: gym, color: "var(--dial-train)" },
    { on: deep, color: "var(--dial-deep)" },
  ];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {arcs.map((segment, i) => (
        <circle
          key={i}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={segment.on ? segment.color : "var(--dial-off)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c - arc}`}
          transform={`rotate(${-90 + i * 120} ${size / 2} ${size / 2})`}
        />
      ))}
    </svg>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

function PillButton({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "soft";
}) {
  const styles =
    variant === "primary" ? "btn-accent" : "bg-accent-soft text-accent";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`hit h-9 shrink-0 rounded-full px-4 text-[14px] font-semibold transition active:scale-95 disabled:opacity-35 disabled:active:scale-100 ${styles}`}
    >
      {children}
    </button>
  );
}

function DoneBadge() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good-soft text-good">
      <Check className="h-[18px] w-[18px]" strokeWidth={3} />
    </span>
  );
}

function TaskRow({
  index,
  bar,
  title,
  detail,
  detailTone = "muted",
  action,
  footer,
}: {
  index: string;
  bar: string;
  title: string;
  detail: ReactNode;
  detailTone?: "muted" | "bad" | "good";
  action: ReactNode;
  footer?: ReactNode;
}) {
  const detailColor = detailTone === "bad" ? "text-bad" : detailTone === "good" ? "text-good" : "text-muted";
  return (
    <div className="card relative overflow-hidden px-4 py-4">
      <span className={`absolute bottom-4 left-0 top-4 w-[3px] rounded-full ${bar}`} />
      <div className="flex items-center gap-3 pl-3">
        <span className="w-9 shrink-0 font-[family-name:var(--font-display)] text-[28px] italic leading-none text-accent">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-tight">{title}</p>
          <p className={`mt-1 text-[13px] tabular-nums leading-snug ${detailColor}`}>{detail}</p>
        </div>
        {action}
      </div>
      {footer}
    </div>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function Page() {
  const { hydrated, state, today, profile, entitlement, todayLog, streak, score, actions } = useVelocity();
  const [now, setNow] = useState(() => new Date());
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    setFocusMode(isNative() && focusEnabled());
  }, []);

  const running = runningTask(todayLog);
  const findTask = (id: string) => tasksOf(todayLog).find((t) => t.id === id);

  // Same actions, plus the native side effects: haptics, Focus mode, and the task alarm.
  const act = {
    logWake: () => (actions.logWake(), tapSuccess()),
    checkInGym: () => (actions.checkInGym(), tapSuccess()),
    // Start the timer first, then hand off to Shortcuts to turn Focus on (no-op if not set up).
    startDeepWork: () => (actions.startDeepWork(), tapLight(), isPro(entitlement, now) && void runFocus("on")),
    stopDeepWork: () => (actions.stopDeepWork(), tapLight(), void cancelTaskAlarm(), void runFocus("off")),
    undo: (task: "wake" | "gym") => (actions.undo(task), tapLight()),

    addTask: actions.addTask,
    carryOverTasks: actions.carryOverTasks,
    startTask: (id: string) => {
      const task = findTask(id);
      if (!task || task.done) return;
      const focusAlreadyOn = !!activeSession(todayLog); // switching tasks mid-block: Focus is already on
      actions.startTask(id);
      tapLight();
      void (async () => {
        await scheduleTaskAlarm(task.title, taskRemaining(task, new Date())).catch(() => {});
        if (!focusAlreadyOn && isPro(entitlement, now)) await runFocus("on");
      })();
    },
    pauseTask: (id: string) => {
      actions.pauseTask(id);
      tapLight();
      void cancelTaskAlarm();
      void runFocus("off");
    },
    toggleTaskDone: (id: string) => {
      const wasRunning = running?.id === id;
      const markingDone = !findTask(id)?.done;
      actions.toggleTaskDone(id);
      if (markingDone) tapSuccess();
      else tapLight();
      if (wasRunning) {
        void cancelTaskAlarm();
        void runFocus("off");
      }
    },
    removeTask: (id: string) => {
      const wasRunning = running?.id === id;
      actions.removeTask(id);
      if (wasRunning) {
        void cancelTaskAlarm();
        void runFocus("off");
      }
    },
  };

  // Buzz once at the moment a running task hits its time (the notification covers a locked phone).
  const buzzedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!running) return;
    const left = taskRemaining(running, now);
    const key = `${running.id}:${running.minutes}`;
    if (left <= 0 && left > -2 && buzzedFor.current !== key) {
      buzzedFor.current = key;
      tapSuccess();
    }
  }, [now, running]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!hydrated) {
    return <div className="min-h-dvh bg-bg" />;
  }

  if (!profile.onboarded) {
    return <Onboarding onComplete={actions.completeOnboarding} />;
  }

  const pro = isPro(entitlement, now);
  const coach = getCoachReport(state, today, now, streak);
  const insights = pro ? coach.insights : coach.insights.filter((insight) => insight.id === "baseline");
  const lockedPatterns = !pro && coach.insights.some((insight) => insight.id !== "baseline");
  const tone = TONE[coach.directive.tone];
  const doneCount = completedCount(todayLog);

  // Wake
  const opensAt = displayClock(minutesToClock(wakeWindowOpensAt(profile)));
  const closesAt = displayClock(minutesToClock(wakeWindowClosesAt(profile)));
  const windowState = wakeWindowState(profile, now);
  const yesterday = addDays(today, -1);
  const spillover =
    isWakeSpillover(profile, now) && yesterday >= profile.startDate && !state.logs[yesterday]?.wake;
  const wakeStamp = stampOf(todayLog.wake);
  const canUndoWake = !!wakeStamp && now.getTime() - new Date(wakeStamp).getTime() < UNDO_WINDOW_MS;

  // Gym
  const gymStamp = stampOf(todayLog.gym);
  const canUndoGym = !!gymStamp && now.getTime() - new Date(gymStamp).getTime() < UNDO_WINDOW_MS;

  // Deep work
  const session = activeSession(todayLog);
  const liveSeconds = session ? (now.getTime() - new Date(session.startedAt).getTime()) / 1000 : 0;
  const deepSeconds = todayLog.deepWork.totalMinutes * 60 + liveSeconds;
  const deepTargetMin = deepWorkTargetFor(todayLog, profile); // the target today started with
  const deepTarget = deepTargetMin * 60;
  const deepMinLabel = (sec: number) => `${Math.floor(sec / 60)} of ${deepTargetMin} min`;
  const deepPct = Math.min(1, deepSeconds / deepTarget);

  // When the coach says "deep work" and a task is planned, the button starts that task.
  const upNext = running ? null : nextTask(todayLog);
  const focusAction: Record<TaskId, { label: string; run: () => void }> = {
    wake: { label: "Log wake-up", run: act.logWake },
    gym: { label: "Check in", run: act.checkInGym },
    deepWork: upNext
      ? {
          label: `Start “${upNext.title.length > 26 ? `${upNext.title.slice(0, 25)}…` : upNext.title}”`,
          run: () => act.startTask(upNext.id),
        }
      : {
          label: todayLog.deepWork.sessions.length ? "Resume deep work" : "Start deep work",
          run: act.startDeepWork,
        },
  };
  const focus = coach.directive.focus ? focusAction[coach.directive.focus] : null;

  // Week strip: the last 7 days ending today.
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  const dateLine = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <main className="mx-auto w-full max-w-[440px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+40px)]">
      <section className="hero-card -mx-4 rounded-b-[40px] rounded-t-none px-5 pb-7 pt-[calc(env(safe-area-inset-top,0px)+18px)]">
        <div className="pointer-events-none absolute inset-4 z-[1]" aria-hidden>
          <span className="absolute left-0 top-0 h-4 w-4 border-l border-t border-current opacity-40" />
          <span className="absolute right-0 top-0 h-4 w-4 border-r border-t border-current opacity-40" />
          <span className="absolute bottom-0 left-0 h-4 w-4 border-b border-l border-current opacity-40" />
          <span className="absolute bottom-0 right-0 h-4 w-4 border-b border-r border-current opacity-40" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <p className="dim text-[11px] font-semibold tracking-[0.28em]">VELOCITY</p>
            <div className="flex items-center gap-2">
              {!pro ? (
                <Link href="/pro" className="glass-chip hit flex h-9 items-center px-3 text-[13px] font-semibold tracking-[0.08em] transition active:scale-95">
                  PRO
                </Link>
              ) : (
                <span className="glass-chip flex h-9 items-center px-3 text-[13px] font-semibold tracking-[0.08em]">PRO</span>
              )}
              <Link href="/settings" aria-label="Settings" className="glass-chip hit flex h-9 w-9 items-center justify-center transition active:scale-95">
                <Settings className="h-[18px] w-[18px]" />
              </Link>
            </div>
          </div>

          <p className="dim mt-7 text-[11px] font-semibold uppercase tracking-[0.22em]">{dateLine}</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <h1 className="hero-num font-[family-name:var(--font-display)] text-[92px] italic leading-[0.78] tracking-[-0.04em] tabular-nums">
                <span className="sr-only">Today. </span>
                {streak.current}
                <span className="sr-only"> day streak</span>
              </h1>
              <p className="mt-3 text-[11px] font-semibold tracking-[0.22em]">DAY STREAK</p>
              <p className="dim mt-1 text-[13px] tabular-nums">
                Best {streak.longest} · {streak.totalExecutedDays} executed
              </p>
            </div>
            <div className="relative shrink-0">
              <DayDial wake={todayLog.completed.wake} gym={todayLog.completed.gym} deep={todayLog.completed.deepWork} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-[family-name:var(--font-display)] text-[28px] italic leading-none tabular-nums">
                  {doneCount}
                  <span className="dim">/3</span>
                </span>
              </div>
            </div>
          </div>
          {coach.milestone && (
            <div className="hero-chip mt-6 rounded-[18px] px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] leading-snug">
                  <span className="font-[family-name:var(--font-display)] text-[20px] italic">{coach.milestone.remaining}</span>{" "}
                  {coach.milestone.remaining === 1 ? "day" : "days"} to a {coach.milestone.target}-day streak
                </p>
                <span className="font-[family-name:var(--font-display)] text-[18px] italic tabular-nums">
                  {streak.current}/{coach.milestone.target}
                </span>
              </div>
              <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-current/15">
                <div
                  className="h-full rounded-full bg-current"
                  style={{ width: `${Math.min(100, (streak.current / coach.milestone.target) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="mt-8 flex flex-col gap-8">
        <section>
          <SectionLabel index="01">Coach</SectionLabel>
          <div className="flex gap-4 px-1">
            <div className={`mt-1 w-[3px] shrink-0 rounded-full ${tone.dot}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${tone.text}`}>{tone.label}</p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-[34px] italic leading-[1.05] [text-wrap:balance]">
                {coach.directive.headline}
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">{coach.directive.body}</p>
              {focus && (
                <button
                  onClick={focus.run}
                  className="btn-accent mt-4 flex h-12 w-full items-center justify-center gap-1 rounded-full text-[15px] font-semibold transition active:scale-[0.98]"
                >
                  {focus.label}
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </section>

        {trialEndsSoon(entitlement, now) ? (
          <Link href="/pro" className="card block border-l-4 border-l-accent bg-accent-soft px-5 py-4">
            <p className="font-[family-name:var(--font-display)] text-[26px] italic leading-tight">Your wake reminder stops with the trial.</p>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">
              Lights out at {displayClock(lightsOut(upcomingStandard(profile)))} is part of the trial. Keep both on the yearly plan.
            </p>
            <p className="mt-3 text-[14px] font-semibold text-accent">Stay on yearly</p>
          </Link>
        ) : !pro && (doneCount > 0 || windowState === "closed") ? (
          <Link href="/pro" className="card block border-l-4 border-l-accent bg-accent-soft px-5 py-4">
            <p className="font-[family-name:var(--font-display)] text-[26px] italic leading-tight">
              Lights out at {displayClock(lightsOut(upcomingStandard(profile)))}.
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">
              Pro sets that reminder and the wake alarm inside your window. Wake, train, and deep work stay free.
            </p>
            <p className="mt-3 text-[14px] font-semibold text-accent">
              {trialAvailable(entitlement, now) ? "Start the 7-day trial" : "See Pro"}
            </p>
          </Link>
        ) : null}

        {pro && isExecuted(todayLog) && (
          <DayShare
            dateLabel={dateLine}
            executed={isExecuted(todayLog)}
            grade={score.grade}
            streak={streak.current}
            wake={todayLog.completed.wake}
            gym={todayLog.completed.gym}
            deepWork={todayLog.completed.deepWork}
            partnerName={profile.partnerName ?? ""}
            onPartner={actions.setPartnerName}
          />
        )}

        {/* Non-negotiables */}
        <section>
          <SectionLabel index="02">Non-negotiables</SectionLabel>
          <div className="flex flex-col gap-3">
            {/* Wake */}
            <TaskRow
              index="01"
              bar="bg-amber"
              title={`Wake by ${displayClock(profile.wakeTarget)}`}
              detailTone={todayLog.wake && !todayLog.wake.onTime ? "bad" : todayLog.completed.wake ? "good" : "muted"}
              detail={
                todayLog.wake
                  ? `Logged ${wakeStamp ? formatClock(wakeStamp) : ""} · ${todayLog.wake.onTime ? "on time" : "missed window"}`
                  : spillover
                    ? `Last night's window closes at ${closesAt}`
                    : windowState === "early"
                      ? `Window opens at ${opensAt}`
                      : windowState === "open"
                        ? `Window open until ${closesAt}`
                        : `Window closed at ${closesAt}`
              }
              action={
                todayLog.completed.wake ? (
                  canUndoWake ? (
                    <PillButton variant="soft" onClick={() => act.undo("wake")}>Undo</PillButton>
                  ) : (
                    <DoneBadge />
                  )
                ) : todayLog.wake ? (
                  canUndoWake ? <PillButton variant="soft" onClick={() => act.undo("wake")}>Undo</PillButton> : null
                ) : spillover || windowState !== "closed" ? (
                  <PillButton onClick={act.logWake} disabled={!spillover && windowState === "early"}>
                    I&apos;m up
                  </PillButton>
                ) : (
                  <PillButton onClick={act.logWake}>Log wake-up</PillButton>
                )
              }
            />

            {/* Gym */}
            <TaskRow
              index="02"
              bar="bg-bad"
              title="Train"
              detailTone={todayLog.completed.gym ? "good" : "muted"}
              detail={gymStamp ? `Checked in ${formatClock(gymStamp)}` : "Check in when you arrive"}
              action={
                todayLog.completed.gym ? (
                  canUndoGym ? (
                    <PillButton variant="soft" onClick={() => act.undo("gym")}>Undo</PillButton>
                  ) : (
                    <DoneBadge />
                  )
                ) : (
                  <PillButton onClick={act.checkInGym}>Check in</PillButton>
                )
              }
            />

            {/* Deep work */}
            <TaskRow
              index="03"
              bar="bg-calm"
              title={`Deep work · ${deepTargetMin} min`}
              detailTone={todayLog.completed.deepWork ? "good" : "muted"}
              detail={
                session
                  ? `${focusMode ? "Focus on" : "In session"} · ${formatDuration(liveSeconds)} · ${deepMinLabel(deepSeconds)}`
                  : todayLog.deepWork.sessions.length
                    ? deepSeconds >= 60
                      ? deepMinLabel(deepSeconds)
                      : "Under a minute"
                    : "One task. Phone in another room."
              }
              action={
                session ? (
                  <PillButton variant="soft" onClick={act.stopDeepWork}>Stop</PillButton>
                ) : todayLog.completed.deepWork ? (
                  <DoneBadge />
                ) : (
                  <PillButton onClick={act.startDeepWork}>
                    {todayLog.deepWork.sessions.length ? "Resume" : "Start"}
                  </PillButton>
                )
              }
              footer={
                deepSeconds > 0 && !todayLog.completed.deepWork ? (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-fill">
                    <div
                      className="h-full rounded-full bg-calm transition-[width] duration-1000 ease-linear"
                      style={{ width: `${deepPct * 100}%` }}
                    />
                  </div>
                ) : null
              }
            />
          </div>
        </section>

        {/* Timed tasks */}
        <TaskList log={todayLog} yesterday={state.logs[addDays(today, -1)]} now={now} pro={pro} actions={act} />

        {/* Week */}
        <section>
          <SectionLabel index="04">This week</SectionLabel>
          <Card className="relative px-3 py-4">
            <div className="pointer-events-none absolute left-7 right-7 top-[47px] h-px bg-line" />
            <div className="relative grid grid-cols-7 gap-1">
              {week.map((key) => {
                const log = state.logs[key];
                const executed = isExecuted(log);
                const count = completedCount(log);
                const isToday = key === today;
                const beforeStart = key < profile.startDate;
                return (
                  <div key={key} className="flex flex-col items-center gap-2">
                    <span className={`text-[12px] font-semibold ${isToday ? "text-ink" : "text-faint"}`}>
                      {WEEKDAY[fromDateKey(key).getDay()]}
                    </span>
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${
                        executed
                          ? "mark-good"
                          : beforeStart
                            ? "bg-transparent text-faint"
                            : count > 0
                              ? "mark"
                              : "bg-fill text-faint"
                      } ${isToday ? "ring-2 ring-accent ring-offset-2 ring-offset-card" : ""}`}
                    >
                      {executed ? <Check className="h-4 w-4" strokeWidth={3} /> : beforeStart ? "·" : count}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>

        {/* Stats */}
        <section>
          <SectionLabel index="05">Execution</SectionLabel>
          <Card className="grid grid-cols-2 overflow-hidden">
            {[
              { label: "Grade", value: score.grade === "NEW" ? "New" : score.grade.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) },
              { label: "7-day", value: score.rolling7 === null ? "—" : `${score.rolling7}%` },
              { label: "30-day", value: score.rolling30 === null ? "—" : `${score.rolling30}%` },
              { label: "Best streak", value: `${streak.longest}` },
            ].map((s, i) => (
              <div key={s.label} className={`px-4 py-4 ${i % 2 === 0 ? "border-r border-line" : ""} ${i < 2 ? "border-b border-line" : ""}`}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{s.label}</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-[30px] italic leading-none tabular-nums">{s.value}</p>
              </div>
            ))}
          </Card>
        </section>

        {/* Patterns */}
        {(insights.length > 0 || lockedPatterns) && (
          <section>
            <SectionLabel index="06">Patterns</SectionLabel>
            <Card className="divide-y divide-line overflow-hidden">
              {lockedPatterns && (
                <Link href="/pro" className="block px-4 py-4">
                  <p className="text-[15px] font-semibold leading-snug">A pattern is showing.</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted">
                    Pro names the weak link and the weekday you miss, so the next streak is built on purpose.
                  </p>
                  <p className="mt-2 text-[14px] font-semibold text-accent">Unlock with Pro</p>
                </Link>
              )}
              {insights.map((insight) => (
                <div key={insight.id} className="flex gap-3 px-4 py-4">
                  <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${INSIGHT_DOT[insight.tone]}`} />
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-snug">{insight.title}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-muted">{insight.body}</p>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        )}

      </div>
    </main>
  );
}
