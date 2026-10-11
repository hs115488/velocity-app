import { describe, expect, it } from "vitest";
import {
  addTask,
  carryOver,
  nextTask,
  pauseAllTasks,
  pauseTask,
  removeTask,
  runningTask,
  startTask,
  taskElapsed,
  taskRemaining,
  tasksOf,
  toggleTaskDone,
} from "@/lib/tasks";
import { closeStaleSessions, createEmptyLog } from "@/lib/velocity";
import { parseState } from "@/lib/storage";
import { at, state, TODAY } from "./helpers";

const base = () =>
  addTask(addTask(createEmptyLog(TODAY), { id: "a", title: "Write proposal", minutes: 45, now: at(9) }), {
    id: "b",
    title: "Review deck",
    minutes: 25,
    now: at(9),
  });

describe("adding tasks", () => {
  it("adds a task with a budget and no time spent", () => {
    expect(tasksOf(base())[0]).toMatchObject({ id: "a", title: "Write proposal", minutes: 45, spentSeconds: 0, done: false });
  });

  it("trims titles and ignores empty titles or zero budgets", () => {
    const log = createEmptyLog(TODAY);
    expect(tasksOf(addTask(log, { id: "x", title: "  Ship it  ", minutes: 15, now: at(9) }))[0].title).toBe("Ship it");
    expect(addTask(log, { id: "x", title: "   ", minutes: 15, now: at(9) })).toBe(log);
    expect(addTask(log, { id: "x", title: "Ship", minutes: 0, now: at(9) })).toBe(log);
  });

  it("caps very long titles", () => {
    const t = tasksOf(addTask(createEmptyLog(TODAY), { id: "x", title: "y".repeat(200), minutes: 15, now: at(9) }))[0];
    expect(t.title).toHaveLength(80);
  });
});

describe("running a task", () => {
  it("counts down from its budget while running", () => {
    const log = startTask(base(), "a", at(9));
    const task = runningTask(log)!;
    expect(task.id).toBe("a");
    expect(taskElapsed(task, at(9, 10))).toBe(600);
    expect(taskRemaining(task, at(9, 10))).toBe(35 * 60);
  });

  it("goes negative once over time", () => {
    const log = startTask(base(), "b", at(9));
    expect(taskRemaining(runningTask(log)!, at(9, 30))).toBe(-5 * 60);
  });

  it("keeps time across pause and resume", () => {
    let log = startTask(base(), "a", at(9));
    log = pauseTask(log, "a", at(9, 10));
    expect(runningTask(log)).toBeNull();
    expect(tasksOf(log)[0].spentSeconds).toBe(600);
    log = startTask(log, "a", at(10));
    expect(taskElapsed(runningTask(log)!, at(10, 5))).toBe(900);
  });

  it("runs only one task at a time: starting another pauses the first", () => {
    let log = startTask(base(), "a", at(9));
    log = startTask(log, "b", at(9, 20));
    expect(runningTask(log)!.id).toBe("b");
    expect(tasksOf(log).find((t) => t.id === "a")!.spentSeconds).toBe(1200);
  });

  it("will not start a finished task", () => {
    const done = toggleTaskDone(base(), "a", at(9));
    expect(startTask(done, "a", at(9, 5))).toBe(done);
  });
});

describe("finishing and removing", () => {
  it("completing a running task stops its timer and keeps the time", () => {
    let log = startTask(base(), "a", at(9));
    log = toggleTaskDone(log, "a", at(9, 40));
    const a = tasksOf(log)[0];
    expect(a).toMatchObject({ done: true, startedAt: null, spentSeconds: 2400 });
  });

  it("can be un-done", () => {
    const log = toggleTaskDone(toggleTaskDone(base(), "a", at(9)), "a", at(9, 1));
    expect(tasksOf(log)[0].done).toBe(false);
  });

  it("next task is the first one not done", () => {
    expect(nextTask(base())!.id).toBe("a");
    expect(nextTask(toggleTaskDone(base(), "a", at(9)))!.id).toBe("b");
  });

  it("removes a task", () => {
    expect(tasksOf(removeTask(base(), "a")).map((t) => t.id)).toEqual(["b"]);
  });

  it("pauseAllTasks stops whatever is running", () => {
    const log = pauseAllTasks(startTask(base(), "b", at(9)), at(9, 5));
    expect(runningTask(log)).toBeNull();
    expect(tasksOf(log)[1].spentSeconds).toBe(300);
  });
});

describe("carry over", () => {
  it("copies unfinished tasks with the time already spent taken off the budget", () => {
    let yesterday = { ...base(), date: "2026-10-02" };
    yesterday = pauseTask(startTask(yesterday, "a", at(9)), "a", at(9, 30)); // 30 of 45 min used
    yesterday = toggleTaskDone(yesterday, "b", at(10));
    let n = 0;
    const today = carryOver(createEmptyLog(TODAY), yesterday, at(8), () => `new-${++n}`);
    expect(tasksOf(today)).toHaveLength(1);
    expect(tasksOf(today)[0]).toMatchObject({ id: "new-1", title: "Write proposal", minutes: 15, spentSeconds: 0 });
  });

  it("does nothing when everything was finished", () => {
    const log = createEmptyLog(TODAY);
    expect(carryOver(log, toggleTaskDone(toggleTaskDone(base(), "a", at(9)), "b", at(9)), at(8), () => "x")).toBe(log);
  });

  it("skips tasks already on today and still copies the rest", () => {
    const yesterday = { ...base(), date: "2026-10-02" };
    const today = addTask(createEmptyLog(TODAY), { id: "t", title: "Write proposal", minutes: 25, now: at(8) });
    let n = 0;
    const next = carryOver(today, yesterday, at(8), () => `new-${++n}`);
    expect(tasksOf(next).map((t) => t.title)).toEqual(["Write proposal", "Review deck"]);
    expect(carryOver(next, yesterday, at(8, 5), () => "again")).toBe(next);
  });

  it("does not charge time after midnight against a task left running", () => {
    const yesterday = startTask({ ...base(), date: "2026-10-02" }, "a", new Date(2026, 9, 2, 23, 30));
    let n = 0;
    const today = carryOver(createEmptyLog(TODAY), yesterday, at(8), () => `new-${++n}`);
    const copied = tasksOf(today).find((t) => t.title === "Write proposal");
    expect(copied).toMatchObject({ minutes: 15, spentSeconds: 0, startedAt: null });
  });
});

describe("midnight and saving", () => {
  it("pauses a task left running overnight at midnight", () => {
    const yesterday = startTask({ ...base(), date: "2026-10-02" }, "a", new Date(2026, 9, 2, 23, 30));
    const s = closeStaleSessions(state([yesterday]), TODAY, at(7));
    const a = tasksOf(s.logs["2026-10-02"])[0];
    expect(a.startedAt).toBeNull();
    expect(a.spentSeconds).toBe(30 * 60);
  });

  it("survives a save and reload, dropping malformed entries", () => {
    const s = state([base()]);
    const raw = JSON.parse(JSON.stringify(s));
    raw.logs[TODAY].tasks.push({ id: 3, title: null }, "junk");
    const restored = parseState(JSON.stringify(raw));
    expect(tasksOf(restored.logs[TODAY]).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("loads logs saved before tasks existed", () => {
    const s = state([createEmptyLog(TODAY)]);
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.logs[TODAY].tasks;
    expect(tasksOf(parseState(JSON.stringify(raw)).logs[TODAY])).toEqual([]);
  });
});
