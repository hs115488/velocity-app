import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { type DailyLog, type TimedTask, type UserProfile, type VelocityState } from "@/types/velocity";
import { createDefaultProfile, createEmptyLog, finalizeLog } from "./velocity";

export const STORAGE_KEY = "velocity:v1";

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

function validatePending(raw: unknown): UserProfile["pending"] {
  const p = asObj(raw);
  if (typeof p.from !== "string") return null;
  const out: NonNullable<UserProfile["pending"]> = { from: p.from };
  if (typeof p.wakeTarget === "string" && /^\d{2}:\d{2}$/.test(p.wakeTarget)) out.wakeTarget = p.wakeTarget;
  if (typeof p.wakeGraceMinutes === "number" && p.wakeGraceMinutes >= 0) out.wakeGraceMinutes = p.wakeGraceMinutes;
  if (typeof p.deepWorkTargetMinutes === "number" && p.deepWorkTargetMinutes > 0) out.deepWorkTargetMinutes = p.deepWorkTargetMinutes;
  return Object.keys(out).length > 1 ? out : null;
}

/** Keep only well-formed tasks; drop anything malformed instead of failing the whole load. */
function validateTasks(raw: unknown): TimedTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): TimedTask[] => {
    const t = asObj(item);
    if (typeof t.id !== "string" || typeof t.title !== "string" || typeof t.minutes !== "number" || t.minutes <= 0) {
      return [];
    }
    return [
      {
        id: t.id,
        title: t.title,
        minutes: t.minutes,
        spentSeconds: typeof t.spentSeconds === "number" && t.spentSeconds >= 0 ? t.spentSeconds : 0,
        startedAt: typeof t.startedAt === "string" ? t.startedAt : null,
        done: t.done === true,
        createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date(0).toISOString(),
      },
    ];
  });
}

function validateLog(log: unknown): DailyLog | null {
  if (!log || typeof log !== "object") return null;
  const l = log as Obj;
  if (typeof l.date !== "string") return null;

  const deepWork = asObj(l.deepWork);
  const completed = asObj(l.completed);

  return {
    date: l.date,
    wake: l.wake && typeof l.wake === "object" ? (l.wake as DailyLog["wake"]) : null,
    gym: l.gym && typeof l.gym === "object" ? (l.gym as DailyLog["gym"]) : null,
    deepWork: {
      sessions: Array.isArray(deepWork.sessions) ? (deepWork.sessions as DailyLog["deepWork"]["sessions"]) : [],
      totalMinutes: typeof deepWork.totalMinutes === "number" ? deepWork.totalMinutes : 0,
    },
    tasks: validateTasks(l.tasks),
    // The deep work target this day was judged by. Logs saved before this existed adopt the current one.
    ...(typeof l.deepWorkTarget === "number" && l.deepWorkTarget > 0 ? { deepWorkTarget: l.deepWorkTarget } : {}),
    completed: {
      wake: completed.wake === true,
      gym: completed.gym === true,
      deepWork: completed.deepWork === true,
    },
  };
}

export function parseState(raw: string | null): VelocityState {
  if (!raw) return { version: 1, profile: createDefaultProfile(), logs: {} };

  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") throw new Error("Invalid data");

    const state = data as Record<string, unknown>;
    const profile = asObj(state.profile);

    const validated: VelocityState = {
      version: typeof state.version === "number" ? state.version : 1,
      profile: {
        id: typeof profile.id === "string" ? profile.id : createDefaultProfile().id,
        name: typeof profile.name === "string" ? profile.name : "Operator",
        wakeTarget: typeof profile.wakeTarget === "string" ? profile.wakeTarget : "05:30",
        wakeGraceMinutes: typeof profile.wakeGraceMinutes === "number" ? profile.wakeGraceMinutes : 15,
        deepWorkTargetMinutes: typeof profile.deepWorkTargetMinutes === "number" ? profile.deepWorkTargetMinutes : 90,
        startDate: typeof profile.startDate === "string" ? profile.startDate : createDefaultProfile().startDate,
        createdAt: typeof profile.createdAt === "string" ? profile.createdAt : new Date().toISOString(),
        pending: validatePending(profile.pending),
      },
      logs: {},
    };

    if (state.logs && typeof state.logs === "object") {
      for (const [key, log] of Object.entries(state.logs)) {
        const parsed = validateLog(log);
        if (parsed) {
          validated.logs[key] = finalizeLog(parsed, validated.profile);
        }
      }
    }

    return validated;
  } catch {
    return { version: 1, profile: createDefaultProfile(), logs: {} };
  }
}

// ─── Where progress is saved ─────────────────────────────────────────────────
// iPhone app: Capacitor Preferences (native UserDefaults). The web view's
// localStorage is transient there: iOS can reclaim it when storage runs low,
// which would silently erase a user's streak. localStorage is kept as a
// mirror (and is the only store on the web).

const isNative = () => Capacitor.isNativePlatform();

function readLocal(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLocal(raw: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Full or unavailable: on the iPhone, Preferences still holds the data.
  }
}

export async function loadState(): Promise<VelocityState> {
  if (typeof window === "undefined") return parseState(null);
  if (!isNative()) return parseState(readLocal());

  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value !== null) return parseState(value);
    // First launch since the move to native storage: bring over what the web view saved.
    const legacy = readLocal();
    if (legacy !== null) await Preferences.set({ key: STORAGE_KEY, value: legacy });
    return parseState(legacy);
  } catch {
    return parseState(readLocal());
  }
}

/** Writes run one after another, so a slow write can never land after a newer one. */
let writes: Promise<void> = Promise.resolve();

export function saveState(state: VelocityState): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const raw = JSON.stringify(state);
  writes = writes.then(async () => {
    writeLocal(raw);
    if (!isNative()) return;
    try {
      await Preferences.set({ key: STORAGE_KEY, value: raw });
    } catch {
      // Kept in the localStorage mirror; the next save tries again.
    }
  });
  return writes;
}

export function clearState(): Promise<void> {
  writes = writes.then(async () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Unavailable: nothing to clear.
    }
    if (isNative()) await Preferences.remove({ key: STORAGE_KEY }).catch(() => {});
  });
  return writes;
}
