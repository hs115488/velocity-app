import { describe, expect, it } from "vitest";
import { parseState } from "@/lib/storage";
import { getDirective, getMilestone } from "@/lib/coach";
import { computeStreak } from "@/lib/velocity";
import { at, full, state, TODAY } from "./helpers";

describe("parseState", () => {
  it("starts fresh with nothing saved", () => {
    const s = parseState(null);
    expect(s.logs).toEqual({});
    expect(s.profile.wakeTarget).toBe("05:30");
  });

  it("starts fresh instead of crashing on corrupted data", () => {
    expect(parseState("{not json").logs).toEqual({});
    expect(parseState("42").logs).toEqual({});
  });

  it("restores saved history and settings", () => {
    const saved = state([full("2026-10-01")], { wakeTarget: "06:00" });
    saved.logs["2026-10-01"].gym = { checkedInAt: "2026-10-01T18:00:00.000Z" };
    const restored = parseState(JSON.stringify(saved));
    expect(restored.profile.wakeTarget).toBe("06:00");
    expect(restored.logs["2026-10-01"].gym).toEqual({ checkedInAt: "2026-10-01T18:00:00.000Z" });
  });

  it("keeps history even if the saved settings are missing", () => {
    const saved = state([full("2026-10-01")]) as unknown as Record<string, unknown>;
    delete saved.profile;
    const restored = parseState(JSON.stringify(saved));
    expect(Object.keys(restored.logs)).toEqual(["2026-10-01"]);
    expect(restored.profile.deepWorkTargetMinutes).toBe(90);
  });

  it("re-derives completion instead of trusting saved flags", () => {
    const saved = state([]);
    saved.logs["2026-10-01"] = {
      date: "2026-10-01",
      wake: null,
      gym: null,
      deepWork: { sessions: [], totalMinutes: 0 },
      completed: { wake: true, gym: true, deepWork: true }, // tampered
    };
    expect(parseState(JSON.stringify(saved)).logs["2026-10-01"].completed).toEqual({
      wake: false,
      gym: false,
      deepWork: false,
    });
  });
});

describe("coach directive", () => {
  const streak = (s: ReturnType<typeof state>) => computeStreak(s, TODAY);

  it("tells you to sleep in the small hours", () => {
    const s = state([]);
    expect(getDirective(s, TODAY, at(2), streak(s)).tone).toBe("rest");
  });

  it("pushes the wake-up while the window is open", () => {
    const s = state([]);
    const dir = getDirective(s, TODAY, at(5, 35), streak(s));
    expect(dir).toMatchObject({ tone: "urgent", focus: "wake" });
  });

  it("calls a reset once the wake window is missed", () => {
    const s = state([]);
    expect(getDirective(s, TODAY, at(9), streak(s)).tone).toBe("reset");
  });

  it("celebrates an executed day", () => {
    const s = state([full(TODAY)]);
    expect(getDirective(s, TODAY, at(20), streak(s)).tone).toBe("win");
  });
});

describe("milestones", () => {
  it("points at the next milestone", () => {
    expect(getMilestone({ current: 5, longest: 5, totalExecutedDays: 5, lostStreak: 0 })).toMatchObject({
      target: 7,
      remaining: 2,
    });
  });
});
