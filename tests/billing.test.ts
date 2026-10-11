import { describe, expect, it } from "vitest";
import {
  canAddTask,
  canStartTask,
  entitlementFromStore,
  isPro,
  startTrial,
  subscribe,
  trialAvailable,
  trialEndsSoon,
  yearlySavings,
  PRODUCTS,
} from "@/lib/billing";
import { dayReport } from "@/lib/report";
import { parseState } from "@/lib/storage";
import { addDays, computeStreak, createInitialState } from "@/lib/velocity";
import { full, state, TODAY } from "./helpers";

const at = new Date("2026-10-10T12:00:00.000Z");

describe("Pro access", () => {
  it("starts free, and a trial lasts seven days", () => {
    expect(isPro(undefined, at)).toBe(false);
    expect(trialAvailable(undefined, at)).toBe(true);
    const trial = startTrial(undefined, at);
    expect(isPro(trial, at)).toBe(true);
    expect(isPro(trial, new Date(at.getTime() + 8 * 86_400_000))).toBe(false);
    expect(trialAvailable(trial, new Date(at.getTime() + 8 * 86_400_000))).toBe(false);
    expect(startTrial(trial, at)).toBe(trial);
  });

  it("a subscription outlasts the trial and blocks a later trial", () => {
    const yearly = subscribe(PRODUCTS.yearly.id, at);
    expect(isPro(yearly, new Date(at.getTime() + 30 * 86_400_000))).toBe(true);
    expect(startTrial(yearly, at)).toEqual(yearly);
    expect(subscribe(PRODUCTS.monthly.id, at).productId).toBe(PRODUCTS.monthly.id);
  });

  it("a trial warns on its last night, and a paid year does not", () => {
    const trial = startTrial(undefined, at);
    expect(trial.source).toBe("trial");
    expect(trialEndsSoon(trial, at)).toBe(false);
    expect(trialEndsSoon(trial, new Date(at.getTime() + 6 * 86_400_000))).toBe(true);
    const paid = subscribe(PRODUCTS.yearly.id, at);
    expect(trialEndsSoon(paid, new Date(at.getTime() + 364 * 86_400_000))).toBe(false);
  });

  it("the yearly plan is the one that saves money", () => {
    expect(yearlySavings()).toEqual({ monthlyYear: 83.88, saved: 44 });
  });

  it("the App Store period keeps the source StoreKit reported", () => {
    const ends = new Date(at.getTime() + 2 * 86_400_000).toISOString();
    expect(entitlementFromStore(PRODUCTS.yearly.id, ends, "paid").source).toBe("paid");
    expect(entitlementFromStore(PRODUCTS.yearly.id, ends, "trial").source).toBe("trial");
  });

  it("the free plan includes one task", () => {
    expect(canAddTask(0, undefined, at)).toBe(true);
    expect(canAddTask(1, undefined, at)).toBe(false);
    expect(canAddTask(4, startTrial(undefined, at), at)).toBe(true);
    expect(canStartTask(0, undefined, at)).toBe(true);
    expect(canStartTask(1, undefined, at)).toBe(false);
    expect(canStartTask(3, startTrial(undefined, at), at)).toBe(true);
  });
});

describe("saving Pro and first-run setup", () => {
  it("a brand new install still needs setup", () => {
    expect(createInitialState().profile.onboarded).toBe(false);
    expect(parseState(null).profile.onboarded).toBe(false);
  });

  it("an existing history is treated as already set up", () => {
    const restored = parseState(JSON.stringify(state([full(TODAY)])));
    expect(restored.profile.onboarded).toBe(true);
  });

  it("keeps a trial across save and reload", () => {
    const s = createInitialState();
    s.entitlement = startTrial(s.entitlement, at);
    s.profile.onboarded = true;
    const restored = parseState(JSON.stringify(s));
    expect(restored.profile.onboarded).toBe(true);
    expect(isPro(restored.entitlement, at)).toBe(true);
    expect(restored.entitlement?.source).toBe("trial");
  });
});

describe("a damaged save", () => {
  it("drops one bad day and keeps the rest", () => {
    const good = full(TODAY);
    const raw = {
      ...state([good]),
      logs: {
        [TODAY]: good,
        "NaN-NaN-NaN": { date: "NaN-NaN-NaN", wake: null, gym: null, deepWork: { sessions: [null], totalMinutes: 0 }, completed: {} },
      },
    };
    const parsed = parseState(JSON.stringify(raw));
    expect(parsed.logs[TODAY]?.date).toBe(TODAY);
    expect(parsed.logs["NaN-NaN-NaN"]).toBeUndefined();
  });

  it("caps a long name and does not loop on a nonsense date", () => {
    const raw = state([]);
    raw.profile.name = "A".repeat(80);
    const parsed = parseState(JSON.stringify(raw));
    expect(parsed.profile.name).toHaveLength(40);
    expect(addDays("NaN-NaN-NaN", -1)).toBe("NaN-NaN-NaN");
    const broken = state([]);
    broken.logs["NaN-NaN-NaN"] = full("NaN-NaN-NaN");
    expect(computeStreak(broken, "NaN-NaN-NaN").current).toBe(1);
  });
});

describe("the day one person receives", () => {
  it("names the result, the streak, and which of the three counted", () => {
    expect(
      dayReport({
        dateLabel: "Saturday, October 10",
        executed: false,
        grade: "SLIPPING",
        streak: 0,
        wake: false,
        gym: true,
        deepWork: false,
        partnerName: "Alex",
      }),
    ).toBe("Saturday, October 10. Missed. Streak 0. Grade Slipping. Wake missed. Train. Deep work missed. For Alex.");
  });
});
