// lib/focus.ts
// Turn an iOS Focus on for the length of a deep work block.
//
// iOS has no public API for an app to switch Focus on or off. The supported
// route is the Shortcuts app: the user makes two one-action shortcuts
// ("Set Focus" on / off) and Velocity runs them by name through Shortcuts'
// x-callback URL, which hands control straight back to Velocity afterwards.

import { AppLauncher } from "@capacitor/app-launcher";
import { isNative } from "@/lib/native";

export const FOCUS_SHORTCUTS = {
  on: "Velocity Focus On",
  off: "Velocity Focus Off",
} as const;

const FOCUS_KEY = "velocity:focus";
/** Registered in the iOS app's Info.plist, so Shortcuts can return to Velocity. */
const RETURN_URL = "velocity://";

export function focusEnabled(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === "on";
  } catch {
    return false;
  }
}

export function setFocusEnabled(on: boolean): void {
  try {
    localStorage.setItem(FOCUS_KEY, on ? "on" : "off");
  } catch {
    // Storage unavailable: the setting won't persist.
  }
}

function shortcutUrl(name: string): string {
  const back = encodeURIComponent(RETURN_URL);
  // encodeURIComponent, not URLSearchParams: Shortcuts expects %20 for spaces, not "+".
  return (
    `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(name)}` +
    `&x-success=${back}&x-cancel=${back}&x-error=${back}`
  );
}

/** Run the on/off shortcut. `force` runs it even when the setting is off (for the Test buttons). */
export async function runFocus(state: "on" | "off", force = false): Promise<boolean> {
  if (!isNative() || (!force && !focusEnabled())) return false;
  try {
    const { completed } = await AppLauncher.openUrl({ url: shortcutUrl(FOCUS_SHORTCUTS[state]) });
    return completed;
  } catch {
    return false;
  }
}

/** Open the Shortcuts app on a new, empty shortcut. */
export async function openShortcutsEditor(): Promise<void> {
  if (!isNative()) return;
  await AppLauncher.openUrl({ url: "shortcuts://create-shortcut" }).catch(() => {});
}
