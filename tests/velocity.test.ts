import { describe, expect, it } from "vitest";
import {
  addDays,
  closeStaleSessions,
  computeScore,
  computeStreak,
  createEmptyLog,
  daysBetween,
  evaluateWake,
  finalizeLog,
  gradeFor,
  isExecuted,
  isWakeSpillover,
  wakeWindowState,
} from "@/lib/velocity";
import { at, full, log, profile, state, TODAY } from "./helpers";

const d = (n: number) => addDays(TODAY, n);

describe("dates", () => {
  it("adds days across month boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is unaffected by daylight saving changes", () => {
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
});

describe("wake window", () => {
  const p = profile(); // 05:30 target, 15 min grace, opens 90 min early

  it("is early before it opens", () => {
    expect(wakeWindowState(p, at(3, 59))).toBe("early");
  });

  it("opens 90 minutes before target and closes after the grace period", () => {
    expect(wakeWindowState(p, at(4, 0))).toBe("open");
    expect(wakeWindowState(p, at(5, 45))).toBe("open");
    expect(wakeWindowState(p, at(5, 46))).toBe("closed");
  });

  it("counts an on-time wake and records how far off target it was", () => {
    expect(evaluateWake(p, at(5, 40))).toEqual({ minutesOff: 10, onTime: true });
    expect(evaluateWake(p, at(5, 20))).toEqual({ minutesOff: -10, onTime: true });
  });

  it("does not count a late wake", () => {
    expect(evaluateWake(p, at(6, 30)).onTime).toBe(false);
  });

  it("never counts a tap between midnight and 4 AM", () => {
    expect(evaluateWake(profile({ wakeTarget: "04:30" }), at(3, 30)).onTime).toBe(false);
  });

  it("keeps a late-night grace period open after midnight", () => {
    const night = profile({ wakeTarget: "23:50", wakeGraceMinutes: 30 });
    expect(isWakeSpillover(night, at(0, 10))).toBe(true);
    expect(evaluateWake(night, at(0, 10))).toEqual({ minutesOff: 20, onTime: true });
    expect(isWakeSpillover(night, at(0, 21))).toBe(false);
    expect(evaluateWake(night, at(0, 21)).onTime).toBe(false);
  });
});

describe("finalizeLog", () => {
  const p = profile();

  it("marks deep work done only once closed sessions reach the target", () => {
    const base = createEmptyLog(TODAY);
    const sessions = [
      { startedAt: at(9).toISOString(), endedAt: at(10).toISOString() },
      { startedAt: at(11).toISOString(), endedAt: at(11, 29).toISOString() },
    ];
    const short = finalizeLog({ ...base, deepWork: { sessions, totalMinutes: 0 } }, p);
    expect(short.deepWork.totalMinutes).toBe(89);
    expect(short.completed.deepWork).toBe(false);

    sessions[1].endedAt = at(11, 30).toISOString();
    expect(finalizeLog({ ...base, deepWork: { sessions, totalMinutes: 0 } }, p).completed.deepWork).toBe(true);
  });

  it("does not count a running session until it is stopped", () => {
    const base = createEmptyLog(TODAY);
    const running = finalizeLog(
      { ...base, deepWork: { sessions: [{ startedAt: at(6).toISOString(), endedAt: null }], totalMinutes: 0 } },
      p,
    );
    expect(running.completed.deepWork).toBe(false);
  });

  it("gives no credit for a late wake but credits any gym check-in", () => {
    const late = finalizeLog(
      {
        ...createEmptyLog(TODAY),
        wake: { loggedAt: at(7).toISOString(), minutesOff: 90, onTime: false },
        gym: { checkedInAt: at(18).toISOString() },
      },
      p,
    );
    expect(late.completed).toEqual({ wake: false, gym: true, deepWork: false });
  });
});

describe("closeStaleSessions", () => {
  it("ends a session left running overnight at midnight and credits the day it started", () => {
    const yesterday = d(-1);
    const started = new Date(2026, 9, 2, 23, 0);
    const s = state([
      { ...createEmptyLog(yesterday), deepWork: { sessions: [{ startedAt: started.toISOString(), endedAt: null }], totalMinutes: 0 } },
    ]);
    const closed = closeStaleSessions(s, TODAY, at(8));
    const session = closed.logs[yesterday].deepWork.sessions[0];
    expect(session.endedAt).not.toBeNull();
    expect(new Date(session.endedAt!).getDate()).toBe(2);
    expect(closed.logs[yesterday].deepWork.totalMinutes).toBe(59);
  });

  it("leaves today's running session alone", () => {
    const s = state([
      { ...createEmptyLog(TODAY), deepWork: { sessions: [{ startedAt: at(7).toISOString(), endedAt: null }], totalMinutes: 0 } },
    ]);
    expect(closeStaleSessions(s, TODAY, at(8))).toBe(s);
  });
});

describe("streaks", () => {
  it("is zero with no history", () => {
    expect(computeStreak(state([]), TODAY)).toEqual({ current: 0, longest: 0, totalExecutedDays: 0, lostStreak: 0 });
  });

  it("stands on yesterday while today is still open", () => {
    expect(computeStreak(state([full(d(-2)), full(d(-1))]), TODAY).current).toBe(2);
  });

  it("includes today once today is executed", () => {
    expect(computeStreak(state([full(d(-2)), full(d(-1)), full(TODAY)]), TODAY).current).toBe(3);
  });

  it("only counts a day when all three tasks are done", () => {
    const partial = log(d(-1), { wake: true, gym: true });
    expect(isExecuted(partial)).toBe(false);
    expect(computeStreak(state([full(d(-2)), partial]), TODAY).current).toBe(0);
  });

  it("drops to zero after a missed day and reports the streak that was lost", () => {
    const s = computeStreak(state([full(d(-4)), full(d(-3)), full(d(-2))]), TODAY);
    expect(s.current).toBe(0);
    expect(s.lostStreak).toBe(3);
  });

  it("tracks the longest run and total executed days across gaps", () => {
    const s = computeStreak(state([full(d(-6)), full(d(-5)), full(d(-4)), full(d(-2)), full(d(-1))]), TODAY);
    expect(s.longest).toBe(3);
    expect(s.current).toBe(2);
    expect(s.totalExecutedDays).toBe(5);
  });
});

describe("execution score", () => {
  it("has no score and a NEW grade before any day has finished", () => {
    const score = computeScore(state([], { startDate: TODAY }), TODAY);
    expect(score.rolling7).toBeNull();
    expect(score.grade).toBe("NEW");
  });

  it("does not let an unfinished today drag the score down", () => {
    const s = state([full(d(-2)), full(d(-1)), log(TODAY)], { startDate: d(-2) });
    expect(computeScore(s, TODAY)).toMatchObject({ today: 0, rolling7: 100, grade: "ELITE" });
  });

  it("scores completed tasks out of possible tasks", () => {
    const s = state([log(d(-2), { wake: true }), log(d(-1), { wake: true, gym: true })], { startDate: d(-2) });
    expect(computeScore(s, TODAY).rolling7).toBe(50);
  });

  it("maps scores to grades", () => {
    expect(gradeFor(95)).toBe("ELITE");
    expect(gradeFor(70)).toBe("ON TRACK");
    expect(gradeFor(40)).toBe("SLIPPING");
    expect(gradeFor(39)).toBe("FAILING");
  });
});
