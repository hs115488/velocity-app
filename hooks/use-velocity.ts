// hooks/use-velocity.ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DateKey, TaskId, UserProfile, VelocityState } from "@/types/velocity";
import { STORAGE_KEY, clearState, loadState, parseState, saveState } from "@/lib/storage";
import {
  activeSession,
  addDays,
  changeStandard,
  rollover,
  STANDARD_KEYS,
  computeScore,
  computeStreak,
  createEmptyLog,
  createInitialState,
  evaluateWake,
  finalizeLog,
  toDateKey,
  wakeWindowState,
} from "@/lib/velocity";
import * as tasks from "@/lib/tasks";
import { pauseAllTasks } from "@/lib/tasks";
import type { DailyLog } from "@/types/velocity";

/** Mis-taps happen. Wake and gym logs can be undone for this long, then they're final. */
export const UNDO_WINDOW_MS = 60_000;

/** Start a deep work session unless one is already running. */
function openSession(log: DailyLog, now: Date): DailyLog {
  if (activeSession(log)) return log;
  return {
    ...log,
    deepWork: { ...log.deepWork, sessions: [...log.deepWork.sessions, { startedAt: now.toISOString(), endedAt: null }] },
  };
}

/** End the running deep work session, if any. */
function closeSession(log: DailyLog, now: Date): DailyLog {
  if (!activeSession(log)) return log;
  return {
    ...log,
    deepWork: {
      ...log.deepWork,
      sessions: log.deepWork.sessions.map((s) => (s.endedAt === null ? { ...s, endedAt: now.toISOString() } : s)),
    },
  };
}

export function useVelocity() {
  const [state, setState] = useState<VelocityState>(createInitialState);
  const [hydrated, setHydrated] = useState(false);
  const [today, setToday] = useState<DateKey>(() => toDateKey());

  // Load once on the client (localStorage doesn't exist during SSR).
  // Sessions left running on a past day (app closed mid-block) are closed out.
  useEffect(() => {
    setState(rollover(loadState(), toDateKey(), new Date()));
    setHydrated(true);
  }, []);

  // Persist every change after hydration.
  useEffect(() => {
    if (hydrated) saveState(state);
  }, [state, hydrated]);

  // Another tab wrote: adopt its state so the next write here doesn't overwrite it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setState(parseState(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Midnight rollover: the slate wipes itself even if the tab stays open,
  // and a session still running at midnight is credited to the day it started.
  useEffect(() => {
    const tick = () => {
      const now = toDateKey();
      setToday(now); // no re-render when unchanged
      setState((s) => rollover(s, now, new Date())); // returns s itself when nothing changed
    };
    const id = window.setInterval(tick, 15_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const todayLog = state.logs[today] ?? createEmptyLog(today);

  /**
   * Apply a mutation to today's log, then re-derive completion.
   * "Today" is read from the clock at the moment of the tap, not from state,
   * so a tap seconds after midnight never lands on yesterday.
   */
  const mutateToday = useCallback(
    (fn: (log: VelocityState["logs"][string], profile: UserProfile) => VelocityState["logs"][string]) => {
      const key = toDateKey();
      setToday((prev) => (prev === key ? prev : key));
      setState((prev) => {
        const base = rollover(prev, key, new Date());
        const current = base.logs[key] ?? createEmptyLog(key);
        const next = finalizeLog(fn(current, base.profile), base.profile);
        return { ...base, logs: { ...base.logs, [key]: next } };
      });
    },
    [],
  );

  const logWake = useCallback(() => {
    mutateToday((log, profile) => {
      const now = new Date();
      if (log.wake) return log; // one shot per day
      if (wakeWindowState(profile, now) === "early") return log; // can't log before the window opens
      return { ...log, wake: { loggedAt: now.toISOString(), ...evaluateWake(profile, now) } };
    });
  }, [mutateToday]);

  const checkInGym = useCallback(() => {
    mutateToday((log) =>
      log.gym ? log : { ...log, gym: { checkedInAt: new Date().toISOString() } },
    );
  }, [mutateToday]);

  const startDeepWork = useCallback(() => {
    mutateToday((log) => openSession(log, new Date()));
  }, [mutateToday]);

  /** Stopping deep work also pauses the running task: one clock, never two that disagree. */
  const stopDeepWork = useCallback(() => {
    mutateToday((log) => {
      const now = new Date();
      return closeSession(pauseAllTasks(log, now), now);
    });
  }, [mutateToday]);

  // ─── Timed tasks ───────────────────────────────────────────────────────────

  const addTask = useCallback(
    (title: string, minutes: number) => {
      mutateToday((log) => tasks.addTask(log, { id: tasks.newTaskId(), title, minutes, now: new Date() }));
    },
    [mutateToday],
  );

  /** Starting a task starts (or continues) the deep work timer too. */
  const startTask = useCallback(
    (id: string) => {
      mutateToday((log) => {
        const now = new Date();
        const started = tasks.startTask(log, id, now);
        return started === log ? log : openSession(started, now);
      });
    },
    [mutateToday],
  );

  const pauseTask = useCallback(
    (id: string) => {
      mutateToday((log) => {
        const now = new Date();
        return closeSession(tasks.pauseTask(log, id, now), now);
      });
    },
    [mutateToday],
  );

  const toggleTaskDone = useCallback(
    (id: string) => {
      mutateToday((log) => {
        const now = new Date();
        const wasRunning = tasks.runningTask(log)?.id === id;
        const next = tasks.toggleTaskDone(log, id, now);
        return wasRunning ? closeSession(next, now) : next;
      });
    },
    [mutateToday],
  );

  const removeTask = useCallback(
    (id: string) => {
      mutateToday((log) => {
        const now = new Date();
        const wasRunning = tasks.runningTask(log)?.id === id;
        const next = tasks.removeTask(tasks.pauseTask(log, id, now), id);
        return wasRunning ? closeSession(next, now) : next;
      });
    },
    [mutateToday],
  );

  /** Bring yesterday's unfinished tasks onto today. */
  const carryOverTasks = useCallback(() => {
    const yesterday = addDays(toDateKey(), -1);
    setState((prev) => {
      const from = prev.logs[yesterday];
      const key = toDateKey();
      const current = prev.logs[key] ?? createEmptyLog(key);
      const next = tasks.carryOver(current, from, new Date(), tasks.newTaskId);
      return next === current ? prev : { ...prev, logs: { ...prev.logs, [key]: finalizeLog(next, prev.profile) } };
    });
  }, []);

  const undo = useCallback(
    (task: Extract<TaskId, "wake" | "gym">) => {
      mutateToday((log) => {
        const stamp = task === "wake" ? log.wake?.loggedAt : log.gym?.checkedInAt;
        if (!stamp || Date.now() - new Date(stamp).getTime() > UNDO_WINDOW_MS) return log;
        return { ...log, [task]: null };
      });
    },
    [mutateToday],
  );

  /**
   * Wake target, grace and deep work target change right away only while today
   * is untouched; otherwise they start tomorrow, so a day can't be bent to fit.
   */
  const updateProfile = useCallback((patch: Partial<Omit<UserProfile, "id" | "createdAt" | "pending">>) => {
    setState((prev) => {
      const key = toDateKey();
      const base = rollover(prev, key, new Date());
      const standard: Partial<Pick<UserProfile, (typeof STANDARD_KEYS)[number]>> = {};
      const rest: Partial<UserProfile> = {};
      for (const [k, v] of Object.entries(patch)) {
        if ((STANDARD_KEYS as readonly string[]).includes(k)) (standard as Record<string, unknown>)[k] = v;
        else (rest as Record<string, unknown>)[k] = v;
      }
      const withRest = { ...base, profile: { ...base.profile, ...rest } };
      return Object.keys(standard).length ? changeStandard(withRest, standard, key, new Date()) : withRest;
    });
  }, []);

  const resetAll = useCallback(() => {
    clearState();
    setState(createInitialState());
  }, []);

  const streak = useMemo(() => computeStreak(state, today), [state, today]);
  const score = useMemo(() => computeScore(state, today), [state, today]);

  return {
    hydrated,
    state,
    today,
    profile: state.profile,
    todayLog,
    streak,
    score,
    actions: {
      logWake,
      checkInGym,
      startDeepWork,
      stopDeepWork,
      undo,
      updateProfile,
      resetAll,
      addTask,
      startTask,
      pauseTask,
      toggleTaskDone,
      removeTask,
      carryOverTasks,
    },
  };
}

export type VelocityActions = ReturnType<typeof useVelocity>["actions"];
