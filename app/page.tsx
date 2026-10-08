"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Brain, Check, ChevronRight, Dumbbell, Flame, Settings, Sunrise } from "lucide-react";
import { UNDO_WINDOW_MS, useVelocity } from "@/hooks/use-velocity";
import { cancelTaskAlarm, isNative, scheduleTaskAlarm, tapLight, tapSuccess } from "@/lib/native";
import { nextTask, runningTask, tasksOf, taskRemaining } from "@/lib/tasks";
import { TaskList } from "@/components/task-list";
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
  wakeWindowState,
  deepWorkTargetFor,
  displayClock,
  minutesToClock,
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

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{children}</h2>;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[22px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>{children}</div>;
}

function Ring({ value, size = 112, stroke = 10 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-fill)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={value >= 1 ? "var(--color-good)" : "var(--color-accent)"}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
        style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1)" }}
      />
    </svg>
  );
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
    variant === "primary" ? "bg-ink text-bg" : "bg-accent-soft text-accent";
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
  icon,
  tint,
  title,
  detail,
  detailTone = "muted",
  action,
  footer,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  detail: ReactNode;
  detailTone?: "muted" | "bad" | "good";
  action: ReactNode;
  footer?: ReactNode;
}) {
  const detailColor = detailTone === "bad" ? "text-bad" : detailTone === "good" ? "text-good" : "text-muted";
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3.5">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${tint}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-tight">{title}</p>
          <p className={`mt-1 truncate text-[13px] tabular-nums ${detailColor}`}>{detail}</p>
        </div>
        {action}
      </div>
      {footer}
    </div>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function Page() {
  const { hydrated, state, today, profile, todayLog, streak, score, actions } = useVelocity();
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
    startDeepWork: () => (actions.startDeepWork(), tapLight(), void runFocus("on")),
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
        if (!focusAlreadyOn) await runFocus("on");
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

  const coach = getCoachReport(state, today, now, streak);
  const tone = TONE[coach.directive.tone];
  const doneCount = completedCount(todayLog);

  // Wake
  const opensAt = displayClock(minutesToClock(wakeWindowOpensAt(profile)));
  const closesAt = displayClock(minutesToClock(wakeWindowClosesAt(profile)));
  const windowState = wakeWindowState(profile, now);
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
      : { label: "Start deep work", run: act.startDeepWork },
  };
  const focus = coach.directive.focus ? focusAction[coach.directive.focus] : null;

  // Week strip: the last 7 days ending today.
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  const dateLine = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <main className="mx-auto w-full max-w-[440px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+40px)] pt-[calc(env(safe-area-inset-top,0px)+20px)]">
      {/* Header */}
      <header className="flex items-end justify-between px-1 pb-6">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{dateLine}</p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-[34px] font-bold leading-none tracking-[-0.02em]">
            Today
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-9 items-center gap-1.5 rounded-full bg-card px-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <Flame className={`h-4 w-4 ${streak.current > 0 ? "text-accent" : "text-faint"}`} />
            <span className="text-[15px] font-bold tabular-nums">{streak.current}</span>
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            className="hit flex h-9 w-9 items-center justify-center rounded-full bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition active:scale-95"
          >
            <Settings className="h-[18px] w-[18px] text-muted" />
          </Link>
        </div>
      </header>

      <div className="flex flex-col gap-7">
        {/* Hero: today's progress + streak */}
        <Card className="p-5">
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <Ring value={doneCount / 3} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[28px] font-bold leading-none tabular-nums">
                  {doneCount}
                  <span className="text-faint">/3</span>
                </span>
                <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">today</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums">{streak.current}</p>
              <p className="mt-1.5 text-[15px] font-medium">day streak</p>
              <p className="mt-1 text-[13px] text-muted tabular-nums">
                Best {streak.longest} · {streak.totalExecutedDays} days executed
              </p>
            </div>
          </div>
          {coach.milestone && (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-[14px] bg-fill px-3.5 py-3">
              <p className="text-[13px] leading-snug text-muted">
                <span className="font-semibold text-ink">
                  {coach.milestone.remaining} {coach.milestone.remaining === 1 ? "day" : "days"}
                </span>{" "}
                to your {coach.milestone.target}-day milestone
              </p>
              <span className="text-[13px] font-semibold tabular-nums text-muted">
                {streak.current}/{coach.milestone.target}
              </span>
            </div>
          )}
        </Card>

        {/* Coach */}
        <section>
          <SectionLabel>Coach</SectionLabel>
          <Card className="p-5">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone.soft} ${tone.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {tone.label}
            </span>
            <p className="mt-3 text-[22px] font-bold leading-tight tracking-[-0.01em] [text-wrap:balance]">
              {coach.directive.headline}
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{coach.directive.body}</p>
            {focus && (
              <button
                onClick={focus.run}
                className="mt-4 flex h-11 w-full items-center justify-center gap-1 rounded-[14px] bg-ink text-[15px] font-semibold text-bg transition active:scale-[0.98]"
              >
                {focus.label}
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </Card>
        </section>

        {/* Non-negotiables */}
        <section>
          <SectionLabel>Non-negotiables</SectionLabel>
          <Card className="divide-y divide-line overflow-hidden">
            {/* Wake */}
            <TaskRow
              icon={<Sunrise className="h-[22px] w-[22px] text-amber" />}
              tint="bg-amber-soft"
              title={`Wake by ${displayClock(profile.wakeTarget)}`}
              detailTone={todayLog.wake && !todayLog.wake.onTime ? "bad" : todayLog.completed.wake ? "good" : "muted"}
              detail={
                todayLog.wake
                  ? `Logged ${wakeStamp ? formatClock(wakeStamp) : ""} · ${todayLog.wake.onTime ? "on time" : "missed window"}`
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
                ) : windowState === "closed" ? null : (
                  <PillButton onClick={act.logWake} disabled={windowState === "early"}>
                    I&apos;m up
                  </PillButton>
                )
              }
            />

            {/* Gym */}
            <TaskRow
              icon={<Dumbbell className="h-[22px] w-[22px] text-bad" />}
              tint="bg-bad-soft"
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
              icon={<Brain className="h-[22px] w-[22px] text-calm" />}
              tint="bg-calm-soft"
              title={`Deep work · ${deepTargetMin} min`}
              detailTone={todayLog.completed.deepWork ? "good" : "muted"}
              detail={
                session
                  ? `${focusMode ? "Focus on" : "In session"} · ${formatDuration(liveSeconds)} · ${deepMinLabel(deepSeconds)}`
                  : deepSeconds > 0
                    ? deepMinLabel(deepSeconds)
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
                  <div className="ml-[58px] mt-3 h-1.5 overflow-hidden rounded-full bg-fill">
                    <div
                      className="h-full rounded-full bg-calm transition-[width] duration-1000 ease-linear"
                      style={{ width: `${deepPct * 100}%` }}
                    />
                  </div>
                ) : null
              }
            />
          </Card>
        </section>

        {/* Timed tasks */}
        <TaskList log={todayLog} yesterday={state.logs[addDays(today, -1)]} now={now} actions={act} />

        {/* Week */}
        <section>
          <SectionLabel>This week</SectionLabel>
          <Card className="px-4 py-4">
            <div className="grid grid-cols-7 gap-1">
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
                          ? "bg-good text-card"
                          : beforeStart
                            ? "bg-transparent text-faint"
                            : count > 0
                              ? "bg-accent-soft text-accent"
                              : "bg-fill text-faint"
                      } ${isToday ? "ring-2 ring-ink ring-offset-2 ring-offset-card" : ""}`}
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
          <SectionLabel>Execution</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Grade", value: score.grade === "NEW" ? "New" : score.grade.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) },
              { label: "7-day", value: score.rolling7 === null ? "—" : `${score.rolling7}%` },
              { label: "30-day", value: score.rolling30 === null ? "—" : `${score.rolling30}%` },
              { label: "Best streak", value: `${streak.longest}` },
            ].map((s) => (
              <Card key={s.label} className="px-4 py-3.5">
                <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{s.label}</p>
                <p className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.01em] tabular-nums">{s.value}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Patterns */}
        {coach.insights.length > 0 && (
          <section>
            <SectionLabel>Patterns</SectionLabel>
            <Card className="divide-y divide-line overflow-hidden">
              {coach.insights.map((insight) => (
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
