// hooks/use-velocity.ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DateKey, Entitlement, TaskId, UserProfile, VelocityState } from "@/types/velocity";
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
  isExecuted,
  isWakeSpillover,
  toDateKey,
  wakeWindowState,
} from "@/lib/velocity";
import { disableReminders, remindersEnabled, requestAppReview } from "@/lib/native";
import { focusEnabled, setFocusEnabled } from "@/lib/focus";
import { syncPlan } from "@/lib/store";
import * as tasks from "@/lib/tasks";
import { pauseAllTasks } from "@/lib/tasks";
import { canAddTask, canStartTask, isPro } from "@/lib/billing";
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

  // Load once on the client: native storage on the iPhone, localStorage on the web.
  // Sessions left running on a past day (app closed mid-block) are closed out.
  useEffect(() => {
    let live = true;
    loadState().then(async (loaded) => {
      if (!live) return;
      const rolled = rollover(loaded, toDateKey(), new Date());
      setState(rolled);
      setHydrated(true);
      const synced = await syncPlan(rolled.entitlement);
      if (!live || synced.status !== "set") return;
      setState((prev) =>
        JSON.stringify(prev.entitlement) === JSON.stringify(synced.entitlement) ? prev : { ...prev, entitlement: synced.entitlement },
      );
    });
    return () => {
      live = false;
    };
  }, []);

  // Ask StoreKit again when the app comes forward, so a renewal or refund is not stuck on the first expiration.
  useEffect(() => {
    if (!hydrated) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void syncPlan(state.entitlement).then((synced) => {
        if (synced.status !== "set") return;
        setState((prev) =>
          JSON.stringify(prev.entitlement) === JSON.stringify(synced.entitlement) ? prev : { ...prev, entitlement: synced.entitlement },
        );
      });
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [hydrated, state.entitlement]);

  // Reminders and Focus are part of Pro. When it ends, turn them off. The switches are gone by then.
  useEffect(() => {
    if (!hydrated || isPro(state.entitlement, new Date())) return;
    if (remindersEnabled()) void disableReminders();
    if (focusEnabled()) setFocusEnabled(false);
  }, [hydrated, state.entitlement]);

  // Persist every change after hydration. Writes are queued in order by the storage layer.
  useEffect(() => {
    if (hydrated) void saveState(state);
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
    (fn: (log: DailyLog, profile: UserProfile, entitlement: VelocityState["entitlement"]) => DailyLog) => {
      const key = toDateKey();
      setToday((prev) => (prev === key ? prev : key));
      setState((prev) => {
        const base = rollover(prev, key, new Date());
        const current = base.logs[key] ?? createEmptyLog(key);
        const next = finalizeLog(fn(current, base.profile, base.entitlement), base.profile);
        return { ...base, logs: { ...base.logs, [key]: next } };
      });
    },
    [],
  );

  const logWake = useCallback(() => {
    const now = new Date();
    const key = toDateKey(now);
    setToday((prev) => (prev === key ? prev : key));
    setState((prev) => {
      const base = rollover(prev, key, now);
      const yesterday = addDays(key, -1);
      const spill =
        isWakeSpillover(base.profile, now) && yesterday >= base.profile.startDate && !base.logs[yesterday]?.wake;
      const target = spill ? yesterday : key;
      const current = base.logs[target] ?? createEmptyLog(target);
      if (current.wake) return prev;
      if (!spill && wakeWindowState(base.profile, now) === "early") return prev;
      const next = finalizeLog(
        { ...current, wake: { loggedAt: now.toISOString(), ...evaluateWake(base.profile, now) } },
        base.profile,
      );
      return { ...base, logs: { ...base.logs, [target]: next } };
    });
  }, []);

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
      mutateToday((log, _profile, entitlement) => {
        if (!canAddTask(tasks.tasksOf(log).length, entitlement, new Date())) return log;
        return tasks.addTask(log, { id: tasks.newTaskId(), title, minutes, now: new Date() });
      });
    },
    [mutateToday],
  );

  /** Starting a task starts (or continues) the deep work timer too. */
  const startTask = useCallback(
    (id: string) => {
      mutateToday((log, _profile, entitlement) => {
        const index = tasks.tasksOf(log).findIndex((task) => task.id === id);
        if (index < 0 || !canStartTask(index, entitlement, new Date())) return log;
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

  /** Bring yesterday's unfinished tasks onto today. Close out yesterday first so a timer left running stops at midnight. */
  const carryOverTasks = useCallback(() => {
    const key = toDateKey();
    setToday((prev) => (prev === key ? prev : key));
    setState((prev) => {
      const now = new Date();
      const base = rollover(prev, key, now);
      const current = base.logs[key] ?? createEmptyLog(key);
      if (!isPro(base.entitlement, now)) return base;
      const next = tasks.carryOver(current, base.logs[addDays(key, -1)], now, tasks.newTaskId);
      if (next === current) return base;
      return { ...base, logs: { ...base.logs, [key]: finalizeLog(next, base.profile) } };
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

  const completeOnboarding = useCallback(
    (input: { name: string; wakeTarget: UserProfile["wakeTarget"]; deepWorkTargetMinutes: number }) => {
      const name = input.name.trim().slice(0, 40) || "Operator";
      updateProfile({
        name,
        wakeTarget: input.wakeTarget,
        deepWorkTargetMinutes: input.deepWorkTargetMinutes,
        onboarded: true,
        startDate: toDateKey(),
      });
    },
    [updateProfile],
  );

  const applyEntitlement = useCallback((entitlement: Entitlement) => {
    setState((prev) => ({ ...prev, entitlement }));
  }, []);

  const setPartnerName = useCallback((name: string) => {
    const partnerName = name.trim().slice(0, 40);
    setState((prev) => ({ ...prev, profile: { ...prev.profile, partnerName: partnerName || undefined } }));
  }, []);

  const resetAll = useCallback(() => {
    void clearState(); // queued ahead of the save of the fresh state below
    setState(createInitialState());
  }, []);

  // The first fully executed day is the moment to ask for a rating. Once.
  useEffect(() => {
    if (!hydrated || state.profile.reviewRequested || !isExecuted(state.logs[today])) return;
    setState((prev) =>
      prev.profile.reviewRequested ? prev : { ...prev, profile: { ...prev.profile, reviewRequested: true } },
    );
    void requestAppReview();
  }, [hydrated, state, today]);

  const streak = useMemo(() => computeStreak(state, today), [state, today]);
  const score = useMemo(() => computeScore(state, today), [state, today]);

  return {
    hydrated,
    state,
    today,
    profile: state.profile,
    entitlement: state.entitlement,
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
      completeOnboarding,
      applyEntitlement,
      setPartnerName,
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
