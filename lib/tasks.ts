// lib/tasks.ts
// Timed task list. Pure functions over a DailyLog, like lib/velocity.ts:
// no React, no storage, deterministic given their inputs.
//
// Only one task runs at a time. A task's elapsed time is its finished
// stretches (spentSeconds) plus the running stretch since startedAt.

import type { DailyLog, TimedTask } from "@/types/velocity";

export const TASK_DURATIONS = [15, 25, 45, 60, 90] as const;
export const MAX_TITLE_LENGTH = 80;

export const tasksOf = (log: DailyLog | undefined): TimedTask[] => log?.tasks ?? [];

export function runningTask(log: DailyLog | undefined): TimedTask | null {
  return tasksOf(log).find((t) => t.startedAt !== null) ?? null;
}

/** Seconds spent on a task, including a running stretch. */
export function taskElapsed(task: TimedTask, now: Date): number {
  const live = task.startedAt ? Math.max(0, (now.getTime() - new Date(task.startedAt).getTime()) / 1000) : 0;
  return task.spentSeconds + live;
}

/** Seconds left in the budget. Negative once over time. */
export function taskRemaining(task: TimedTask, now: Date): number {
  return task.minutes * 60 - taskElapsed(task, now);
}

/** The next task to work on: the first one not done. */
export function nextTask(log: DailyLog | undefined): TimedTask | null {
  return tasksOf(log).find((t) => !t.done) ?? null;
}

function pause(task: TimedTask, at: Date): TimedTask {
  if (!task.startedAt) return task;
  return { ...task, spentSeconds: Math.round(taskElapsed(task, at)), startedAt: null };
}

function withTasks(log: DailyLog, tasks: TimedTask[]): DailyLog {
  return { ...log, tasks };
}

export function addTask(log: DailyLog, input: { id: string; title: string; minutes: number; now: Date }): DailyLog {
  const title = input.title.trim().slice(0, MAX_TITLE_LENGTH);
  if (!title || !(input.minutes > 0)) return log;
  const task: TimedTask = {
    id: input.id,
    title,
    minutes: Math.round(input.minutes),
    spentSeconds: 0,
    startedAt: null,
    done: false,
    createdAt: input.now.toISOString(),
  };
  return withTasks(log, [...tasksOf(log), task]);
}

/** Start (or resume) a task. Any other running task is paused first. Done tasks can't be started. */
export function startTask(log: DailyLog, id: string, now: Date): DailyLog {
  const target = tasksOf(log).find((t) => t.id === id);
  if (!target || target.done || target.startedAt) return log;
  return withTasks(
    log,
    tasksOf(log).map((t) => (t.id === id ? { ...t, startedAt: now.toISOString() } : pause(t, now))),
  );
}

export function pauseTask(log: DailyLog, id: string, now: Date): DailyLog {
  return withTasks(log, tasksOf(log).map((t) => (t.id === id ? pause(t, now) : t)));
}

/** Pause whatever is running (used when deep work stops, and at midnight). */
export function pauseAllTasks(log: DailyLog, at: Date): DailyLog {
  if (!runningTask(log)) return log;
  return withTasks(log, tasksOf(log).map((t) => pause(t, at)));
}

/** Toggle done. Completing a running task stops its timer. */
export function toggleTaskDone(log: DailyLog, id: string, now: Date): DailyLog {
  return withTasks(
    log,
    tasksOf(log).map((t) => (t.id === id ? { ...pause(t, now), done: !t.done } : t)),
  );
}

export function removeTask(log: DailyLog, id: string): DailyLog {
  return withTasks(log, tasksOf(log).filter((t) => t.id !== id));
}

/** Unfinished tasks from `from` whose title isn't already on `log`. */
export function tasksToCarry(log: DailyLog, from: DailyLog | undefined): TimedTask[] {
  const existing = new Set(tasksOf(log).map((t) => t.title));
  return tasksOf(from).filter((t) => !t.done && !existing.has(t.title));
}

/**
 * Minutes of a task to subtract when copying it forward.
 * A stretch still running is measured through the end of that day, not up to
 * `now`, so time after midnight isn't charged against yesterday's budget.
 */
function spentMinutesForCarry(task: TimedTask, from: DailyLog, now: Date): number {
  if (!task.startedAt) return task.spentSeconds / 60;
  const [y, m, d] = from.date.split("-").map(Number);
  let at = now;
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);
    if (!Number.isNaN(end.getTime()) && end.getTime() < now.getTime()) at = end;
  }
  return pause(task, at).spentSeconds / 60;
}

/**
 * Copy unfinished tasks from another day onto this one, with fresh ids and
 * the time already spent subtracted from the budget (at least 5 minutes left).
 * Tasks already on this day (same title) are left alone, so bringing work
 * forward stays safe after you've added something today.
 */
export function carryOver(log: DailyLog, from: DailyLog | undefined, now: Date, newId: () => string): DailyLog {
  const unfinished = tasksToCarry(log, from);
  if (unfinished.length === 0 || !from) return log;
  const copies: TimedTask[] = unfinished.map((t) => ({
    id: newId(),
    title: t.title,
    minutes: Math.max(5, Math.ceil(t.minutes - spentMinutesForCarry(t, from, now))),
    spentSeconds: 0,
    startedAt: null,
    done: false,
    createdAt: now.toISOString(),
  }));
  return withTasks(log, [...tasksOf(log), ...copies]);
}

export function newTaskId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
