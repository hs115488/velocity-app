import type { DailyLog, DateKey, UserProfile, VelocityState } from "@/types/velocity";
import { createEmptyLog } from "@/lib/velocity";

export const TODAY: DateKey = "2026-10-03";

export function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "test",
    name: "Test",
    wakeTarget: "05:30",
    wakeGraceMinutes: 15,
    deepWorkTargetMinutes: 90,
    startDate: "2026-09-01",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A log with the given tasks marked complete. */
export function log(date: DateKey, done: { wake?: boolean; gym?: boolean; deepWork?: boolean } = {}): DailyLog {
  return {
    ...createEmptyLog(date),
    completed: { wake: !!done.wake, gym: !!done.gym, deepWork: !!done.deepWork },
  };
}

export const full = (date: DateKey) => log(date, { wake: true, gym: true, deepWork: true });

export function state(logs: DailyLog[], p: Partial<UserProfile> = {}): VelocityState {
  return { version: 1, profile: profile(p), logs: Object.fromEntries(logs.map((l) => [l.date, l])) };
}

/** Local time on TODAY. */
export const at = (h: number, m = 0) => new Date(2026, 9, 3, h, m);
