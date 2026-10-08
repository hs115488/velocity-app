// Regression tests for bugs found in the QA pass. Each test names the bug it pins.
import { describe, expect, it } from "vitest";
import {
  addDays,
  applyPendingStandard,
  canChangeStandardToday,
  changeStandard,
  closeStaleSessions,
  computeStreak,
  createEmptyLog,
  evaluateWake,
  finalizeLog,
  rollover,
  upcomingStandard,
  wakeWindowOpensAt,
  wakeWindowState,
} from "@/lib/velocity";
import { parseState } from "@/lib/storage";
import { getDirective } from "@/lib/coach";
import { at, profile, state, TODAY } from "./helpers";

const withDeep = (date: string, minutes: number, p = profile()) =>
  finalizeLog(
    {
      ...createEmptyLog(date),
      deepWork: {
        sessions: [{ startedAt: new Date(2026, 9, 3, 9).toISOString(), endedAt: new Date(2026, 9, 3, 9, minutes).toISOString() }],
        totalMinutes: 0,
      },
    },
    p,
  );

describe("W4: early wake targets", () => {
  it("a 05:00 target opens at 04:00, and a tap inside the window counts", () => {
    const p = profile({ wakeTarget: "05:00" });
    expect(wakeWindowOpensAt(p)).toBe(4 * 60);
    expect(wakeWindowState(p, at(3, 59))).toBe("early");
    expect(evaluateWake(p, at(4, 10)).onTime).toBe(true);
  });

  it("button state and scoring always agree", () => {
    for (const target of ["03:30", "04:00", "04:45", "05:00", "05:30", "07:15"]) {
      const p = profile({ wakeTarget: target });
      for (let m = 0; m < 12 * 60; m += 5) {
        const t = at(Math.floor(m / 60), m % 60);
        expect(evaluateWake(p, t).onTime).toBe(wakeWindowState(p, t) === "open");
      }
    }
  });

  it("a target before 4 AM opens at the target, never earlier", () => {
    expect(wakeWindowOpensAt(profile({ wakeTarget: "03:30" }))).toBe(3 * 60 + 30);
  });

  it("the coach's 'go to sleep' cutoff matches the window", () => {
    const s = state([], { wakeTarget: "05:00" });
    const streak = computeStreak(s, TODAY);
    expect(getDirective(s, TODAY, at(3, 55), streak).tone).toBe("rest");
    expect(getDirective(s, TODAY, at(4, 5), streak)).toMatchObject({ tone: "urgent", focus: "wake" });
  });
});

describe("S1/S2: the standard can't be bent mid-day", () => {
  it("lowering the deep work target after starting does not complete today", () => {
    const s = state([withDeep(TODAY, 60)]);
    const next = changeStandard(s, { deepWorkTargetMinutes: 60 }, TODAY, at(10, 30));
    expect(next.logs[TODAY].completed.deepWork).toBe(false);
    expect(next.profile.deepWorkTargetMinutes).toBe(90);
    expect(next.profile.pending).toEqual({ deepWorkTargetMinutes: 60, from: addDays(TODAY, 1) });
  });

  it("moving the wake target after the window closed does not reopen it today", () => {
    const s = state([]);
    const next = changeStandard(s, { wakeTarget: "07:00" }, TODAY, at(7, 0));
    expect(next.profile.wakeTarget).toBe("05:30");
    expect(wakeWindowState(next.profile, at(7, 0))).toBe("closed");
  });

  it("changes apply immediately on an untouched day before the window opens", () => {
    const s = state([]);
    expect(canChangeStandardToday(undefined, s.profile, at(2))).toBe(true);
    const next = changeStandard(s, { wakeTarget: "06:00", deepWorkTargetMinutes: 60 }, TODAY, at(2));
    expect(next.profile).toMatchObject({ wakeTarget: "06:00", deepWorkTargetMinutes: 60, pending: null });
  });

  it("any activity today locks the standard, even before the wake window", () => {
    const gym = { ...createEmptyLog(TODAY), gym: { checkedInAt: at(2).toISOString() } };
    expect(canChangeStandardToday(gym, profile(), at(2, 30))).toBe(false);
  });

  it("a pending change starts tomorrow, and setting it back cancels it", () => {
    let s = changeStandard(state([withDeep(TODAY, 30)]), { deepWorkTargetMinutes: 60 }, TODAY, at(11));
    expect(upcomingStandard(s.profile).deepWorkTargetMinutes).toBe(60);
    expect(applyPendingStandard(s, TODAY).profile.deepWorkTargetMinutes).toBe(90);
    expect(applyPendingStandard(s, addDays(TODAY, 1)).profile).toMatchObject({ deepWorkTargetMinutes: 60, pending: null });
    s = changeStandard(s, { deepWorkTargetMinutes: 90 }, TODAY, at(11, 5));
    expect(s.profile.pending).toBeNull();
  });

  it("a pending change survives save and reload", () => {
    const s = changeStandard(state([withDeep(TODAY, 30)]), { wakeTarget: "06:15" }, TODAY, at(11));
    expect(parseState(JSON.stringify(s)).profile.pending).toEqual({ wakeTarget: "06:15", from: addDays(TODAY, 1) });
  });
});

describe("History: changing the target never rewrites past days", () => {
  it("raising the target later does not break a past executed day", () => {
    const yesterday = addDays(TODAY, -1);
    const executed = finalizeLog(
      { ...withDeep(yesterday, 95), wake: { loggedAt: "x", minutesOff: 0, onTime: true }, gym: { checkedInAt: "x" } },
      profile(),
    );
    expect(executed.completed).toEqual({ wake: true, gym: true, deepWork: true });
    const s = state([executed]);
    s.profile.deepWorkTargetMinutes = 120; // changed later
    const reloaded = parseState(JSON.stringify(s));
    expect(reloaded.logs[yesterday].completed.deepWork).toBe(true);
    expect(reloaded.logs[yesterday].deepWorkTarget).toBe(90);
  });

  it("lowering the target later does not retroactively complete a past miss", () => {
    const yesterday = addDays(TODAY, -1);
    const s = state([withDeep(yesterday, 60)]);
    s.profile.deepWorkTargetMinutes = 45;
    expect(parseState(JSON.stringify(s)).logs[yesterday].completed.deepWork).toBe(false);
  });
});

describe("M1: midnight", () => {
  it("a session live at midnight carries on into the new day", () => {
    const yesterday = addDays(TODAY, -1);
    const s = state([
      { ...createEmptyLog(yesterday), deepWork: { sessions: [{ startedAt: new Date(2026, 9, 2, 23, 30).toISOString(), endedAt: null }], totalMinutes: 0 } },
    ]);
    const next = rollover(s, TODAY, new Date(2026, 9, 3, 0, 0, 20));
    expect(next.logs[yesterday].deepWork.totalMinutes).toBe(29);
    const today = next.logs[TODAY].deepWork.sessions;
    expect(today).toHaveLength(1);
    expect(today[0]).toEqual({ startedAt: new Date(2026, 9, 3, 0, 0).toISOString(), endedAt: null });
  });

  it("a session from an app closed hours ago just ends, nothing carries over", () => {
    const yesterday = addDays(TODAY, -1);
    const s = state([
      { ...createEmptyLog(yesterday), deepWork: { sessions: [{ startedAt: new Date(2026, 9, 2, 23, 30).toISOString(), endedAt: null }], totalMinutes: 0 } },
    ]);
    expect(closeStaleSessions(s, TODAY, at(7)).logs[TODAY]).toBeUndefined();
  });
});
