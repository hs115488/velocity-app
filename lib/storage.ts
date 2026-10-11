import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { type DailyLog, type TimedTask, type UserProfile, type VelocityState } from "@/types/velocity";
import { defaultEntitlement } from "./billing";
import { createDefaultProfile, createEmptyLog, finalizeLog } from "./velocity";

export const STORAGE_KEY = "velocity:v1";

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME = 40;
const MAX_TITLE = 80;
const MAX_TASK_MINUTES = 24 * 60;

function validateEntitlement(raw: unknown): VelocityState["entitlement"] {
  const e = asObj(raw);
  const expiresAt = typeof e.expiresAt === "string" ? e.expiresAt : null;
    return {
    productId: typeof e.productId === "string" ? e.productId : null,
    expiresAt: expiresAt && !Number.isNaN(new Date(expiresAt).getTime()) ? expiresAt : null,
    trialUsed: e.trialUsed === true,
    ...(e.source === "trial" || e.source === "paid" ? { source: e.source } : {}),
  };
}

function validatePending(raw: unknown): UserProfile["pending"] {
  const p = asObj(raw);
  if (typeof p.from !== "string" || !DATE_KEY.test(p.from)) return null;
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
    if (
      typeof t.id !== "string" ||
      typeof t.title !== "string" ||
      typeof t.minutes !== "number" ||
      !Number.isFinite(t.minutes) ||
      t.minutes <= 0 ||
      t.minutes > MAX_TASK_MINUTES
    ) {
      return [];
    }
    const title = t.title.trim().slice(0, MAX_TITLE);
    if (!title) return [];
    return [
      {
        id: t.id.slice(0, 80),
        title,
        minutes: Math.round(t.minutes),
        spentSeconds: typeof t.spentSeconds === "number" && Number.isFinite(t.spentSeconds) && t.spentSeconds >= 0 ? t.spentSeconds : 0,
        startedAt: typeof t.startedAt === "string" ? t.startedAt : null,
        done: t.done === true,
        createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date(0).toISOString(),
      },
    ];
  });
}

function validateWake(raw: unknown): DailyLog["wake"] {
  const w = asObj(raw);
  if (typeof w.loggedAt !== "string" || typeof w.onTime !== "boolean") return null;
  return {
    loggedAt: w.loggedAt,
    minutesOff: typeof w.minutesOff === "number" && Number.isFinite(w.minutesOff) ? w.minutesOff : 0,
    onTime: w.onTime,
  };
}

function validateGym(raw: unknown): DailyLog["gym"] {
  const g = asObj(raw);
  if (typeof g.checkedInAt !== "string") return null;
  return { checkedInAt: g.checkedInAt };
}

function validateSessions(raw: unknown): DailyLog["deepWork"]["sessions"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const s = asObj(item);
    if (typeof s.startedAt !== "string") return [];
    const endedAt = s.endedAt === null || typeof s.endedAt === "string" ? s.endedAt : null;
    return [{ startedAt: s.startedAt, endedAt }];
  });
}

function validateLog(log: unknown, key: string): DailyLog | null {
  if (!DATE_KEY.test(key)) return null;
  if (!log || typeof log !== "object") return null;
  const l = log as Obj;
  if (l.date !== key) return null;

  const deepWork = asObj(l.deepWork);
  const completed = asObj(l.completed);

  return {
    date: key,
    wake: validateWake(l.wake),
    gym: validateGym(l.gym),
    deepWork: {
      sessions: validateSessions(deepWork.sessions),
      totalMinutes: typeof deepWork.totalMinutes === "number" && Number.isFinite(deepWork.totalMinutes) ? deepWork.totalMinutes : 0,
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
    const name = typeof profile.name === "string" && profile.name.trim() ? profile.name.trim().slice(0, MAX_NAME) : "Operator";
    const hasHistory =
      !!state.logs && typeof state.logs === "object" && Object.keys(state.logs as object).length > 0;

    const validated: VelocityState = {
      version: typeof state.version === "number" ? state.version : 1,
      profile: {
        id: typeof profile.id === "string" ? profile.id : createDefaultProfile().id,
        name,
        wakeTarget: typeof profile.wakeTarget === "string" ? profile.wakeTarget : "05:30",
        wakeGraceMinutes: typeof profile.wakeGraceMinutes === "number" ? profile.wakeGraceMinutes : 15,
        deepWorkTargetMinutes: typeof profile.deepWorkTargetMinutes === "number" ? profile.deepWorkTargetMinutes : 90,
        startDate: typeof profile.startDate === "string" ? profile.startDate : createDefaultProfile().startDate,
        createdAt: typeof profile.createdAt === "string" ? profile.createdAt : new Date().toISOString(),
        // Older saves have no flag. Someone with a history already got past setup.
        onboarded: typeof profile.onboarded === "boolean" ? profile.onboarded : hasHistory || name !== "Operator",
        ...(typeof profile.partnerName === "string" && profile.partnerName.trim()
          ? { partnerName: profile.partnerName.trim().slice(0, 40) }
          : {}),
        ...(profile.reviewRequested === true ? { reviewRequested: true } : {}),
        pending: validatePending(profile.pending),
      },
      entitlement: state.entitlement === undefined ? defaultEntitlement() : validateEntitlement(state.entitlement),
      logs: {},
    };

    if (state.logs && typeof state.logs === "object") {
      for (const [key, log] of Object.entries(state.logs)) {
        const parsed = validateLog(log, key);
        if (!parsed) continue;
        try {
          validated.logs[key] = finalizeLog(parsed, validated.profile);
        } catch {
          // One damaged day is dropped. The rest of the save stays.
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
