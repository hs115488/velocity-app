// Native storage: the iPhone app keeps progress in Capacitor Preferences, not the
// web view's localStorage (which iOS may reclaim). Capacitor is faked here.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  native: true,
  prefs: new Map<string, string>(),
  local: new Map<string, string>(),
  failGet: false,
  failSet: false,
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => h.native } }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => {
      if (h.failGet) throw new Error("native storage unavailable");
      return { value: h.prefs.has(key) ? h.prefs.get(key)! : null };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      if (h.failSet) throw new Error("native storage unavailable");
      // A little latency so out-of-order writes would show up.
      await new Promise((r) => setTimeout(r, value.length % 3));
      h.prefs.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      h.prefs.delete(key);
    },
  },
}));

// A browser-like global for the web view's localStorage.
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.localStorage = {
  getItem: (k: string) => (h.local.has(k) ? h.local.get(k)! : null),
  setItem: (k: string, v: string) => void h.local.set(k, v),
  removeItem: (k: string) => void h.local.delete(k),
};

const { STORAGE_KEY, clearState, loadState, saveState } = await import("@/lib/storage");
const { full, state } = await import("./helpers");

const saved = (date: string) => JSON.stringify(state([full(date)]));

beforeEach(() => {
  h.native = true;
  h.failGet = false;
  h.failSet = false;
  h.prefs.clear();
  h.local.clear();
});

describe("iPhone app storage", () => {
  it("moves existing web-view data into native storage on first launch", async () => {
    h.local.set(STORAGE_KEY, saved("2026-10-01"));
    const s = await loadState();
    expect(Object.keys(s.logs)).toEqual(["2026-10-01"]);
    expect(h.prefs.get(STORAGE_KEY)).toBe(h.local.get(STORAGE_KEY));
  });

  it("reads native storage first, even if the web view has something else", async () => {
    h.prefs.set(STORAGE_KEY, saved("2026-10-02"));
    h.local.set(STORAGE_KEY, saved("2026-09-01"));
    expect(Object.keys((await loadState()).logs)).toEqual(["2026-10-02"]);
  });

  it("keeps progress when iOS has wiped the web view's storage", async () => {
    h.prefs.set(STORAGE_KEY, saved("2026-10-02"));
    // localStorage reclaimed by iOS: empty
    expect(Object.keys((await loadState()).logs)).toEqual(["2026-10-02"]);
  });

  it("saves to native storage and mirrors to the web view", async () => {
    await saveState(state([full("2026-10-03")]));
    expect(JSON.parse(h.prefs.get(STORAGE_KEY)!).logs["2026-10-03"]).toBeTruthy();
    expect(h.local.get(STORAGE_KEY)).toBe(h.prefs.get(STORAGE_KEY));
  });

  it("applies rapid saves in order, so the newest always wins", async () => {
    void saveState(state([full("2026-10-01")]));
    void saveState(state([full("2026-10-01"), full("2026-10-02")]));
    await saveState(state([full("2026-10-01"), full("2026-10-02"), full("2026-10-03")]));
    expect(Object.keys(JSON.parse(h.prefs.get(STORAGE_KEY)!).logs)).toHaveLength(3);
  });

  it("falls back to the web view copy if native storage can't be read", async () => {
    h.local.set(STORAGE_KEY, saved("2026-10-01"));
    h.failGet = true;
    expect(Object.keys((await loadState()).logs)).toEqual(["2026-10-01"]);
  });

  it("a failed native write still leaves the mirror, and doesn't throw", async () => {
    h.failSet = true;
    await expect(saveState(state([full("2026-10-03")]))).resolves.toBeUndefined();
    expect(h.local.get(STORAGE_KEY)).toContain("2026-10-03");
  });

  it("Delete all data clears both stores", async () => {
    await saveState(state([full("2026-10-03")]));
    await clearState();
    expect(h.prefs.has(STORAGE_KEY)).toBe(false);
    expect(h.local.has(STORAGE_KEY)).toBe(false);
  });

  it("starts fresh when nothing has been saved anywhere", async () => {
    expect((await loadState()).logs).toEqual({});
  });
});

describe("web storage", () => {
  it("uses only the browser's storage on the web", async () => {
    h.native = false;
    h.local.set(STORAGE_KEY, saved("2026-10-01"));
    expect(Object.keys((await loadState()).logs)).toEqual(["2026-10-01"]);
    await saveState(state([full("2026-10-04")]));
    expect(h.prefs.size).toBe(0);
  });
});
