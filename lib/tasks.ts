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

/**
 * Copy unfinished tasks from another day onto this one, with fresh ids and
 * the time already spent subtracted from the budget (at least 5 minutes left).
 */
export function carryOver(log: DailyLog, from: DailyLog | undefined, now: Date, newId: () => string): DailyLog {
  const unfinished = tasksOf(from).filter((t) => !t.done);
  if (unfinished.length === 0) return log;
  const copies: TimedTask[] = unfinished.map((t) => ({
    id: newId(),
    title: t.title,
    minutes: Math.max(5, Math.ceil(t.minutes - taskElapsed(t, now) / 60)),
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
