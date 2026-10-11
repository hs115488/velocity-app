// lib/native.ts
// Native iPhone features via Capacitor. Every function is a safe no-op in a
// normal browser, so the same code runs on the web and in the app.

import { AppLauncher } from "@capacitor/app-launcher";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { AppReview } from "@capawesome/capacitor-app-review";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { UserProfile } from "@/types/velocity";
import { lightsOut } from "@/lib/playbook";
import { displayClock } from "@/lib/velocity";
import { APP_VERSION, SUPPORT_EMAIL } from "@/lib/app-config";

export const isNative = () => Capacitor.isNativePlatform();

const REMINDERS_KEY = "velocity:reminders";
const WAKE_ID = 1;
const LIGHTS_OUT_ID = 2;

// ─── Haptics ─────────────────────────────────────────────────────────────────

/** A firm tap when a task is completed. */
export function tapSuccess(): void {
  if (!isNative()) return;
  Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

/** A light tap for secondary actions (start/stop, undo). */
export function tapLight(): void {
  if (!isNative()) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

// ─── Reminders ───────────────────────────────────────────────────────────────

export function remindersEnabled(): boolean {
  try {
    return localStorage.getItem(REMINDERS_KEY) === "on";
  } catch {
    return false;
  }
}

function setRemindersFlag(on: boolean): void {
  try {
    localStorage.setItem(REMINDERS_KEY, on ? "on" : "off");
  } catch {
    // Storage unavailable: reminders still work for this session.
  }
}

/** iOS treats a notification string as a format. A title like "100%" must not reach it raw. */
function notificationText(value: string): string {
  return value.replace(/%/g, "%%");
}

function hm(clock: string): { hour: number; minute: number } {
  const [hour, minute] = clock.split(":").map(Number);
  return { hour, minute };
}

/** (Re)schedule the two daily reminders from the user's current settings. */
export async function scheduleReminders(profile: UserProfile): Promise<void> {
  if (!isNative()) return;
  await LocalNotifications.cancel({ notifications: [{ id: WAKE_ID }, { id: LIGHTS_OUT_ID }] });
  const bed = lightsOut(profile);
  await LocalNotifications.schedule({
    notifications: [
      {
        id: WAKE_ID,
        title: notificationText("Feet on the floor."),
        body: notificationText(`It's ${displayClock(profile.wakeTarget)}. Log your wake-up within ${profile.wakeGraceMinutes} minutes to keep the streak.`),
        schedule: { on: hm(profile.wakeTarget), allowWhileIdle: true },
      },
      {
        id: LIGHTS_OUT_ID,
        title: notificationText("Lights out."),
        body: notificationText(`Phone down. Tomorrow starts at ${displayClock(profile.wakeTarget)}.`),
        schedule: { on: hm(bed), allowWhileIdle: true },
      },
    ],
  });
}

/** Ask permission (first time only) and turn reminders on. Returns whether they're on. */
export async function enableReminders(profile: UserProfile): Promise<boolean> {
  if (!isNative()) return false;
  let { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted") ({ display } = await LocalNotifications.requestPermissions());
  if (display !== "granted") {
    setRemindersFlag(false);
    return false;
  }
  await scheduleReminders(profile);
  setRemindersFlag(true);
  return true;
}

// ─── Task timer alarm ────────────────────────────────────────────────────────

const TASK_ALARM_ID = 100;

/**
 * Notify when a task's time budget runs out, even if the phone is locked.
 * Asks for notification permission the first time a timer starts.
 */
export async function scheduleTaskAlarm(title: string, secondsFromNow: number): Promise<void> {
  if (!isNative()) return;
  await LocalNotifications.cancel({ notifications: [{ id: TASK_ALARM_ID }] });
  if (secondsFromNow < 1) return;
  let { display } = await LocalNotifications.checkPermissions();
  if (display === "prompt" || display === "prompt-with-rationale") {
    ({ display } = await LocalNotifications.requestPermissions());
  }
  if (display !== "granted") return;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: TASK_ALARM_ID,
        title: notificationText(`Time's up: ${title}`),
        body: notificationText("Wrap it up, or keep going on overtime."),
        schedule: { at: new Date(Date.now() + secondsFromNow * 1000), allowWhileIdle: true },
      },
    ],
  });
}

export async function cancelTaskAlarm(): Promise<void> {
  if (!isNative()) return;
  await LocalNotifications.cancel({ notifications: [{ id: TASK_ALARM_ID }] });
}

export async function disableReminders(): Promise<void> {
  setRemindersFlag(false);
  if (!isNative()) return;
  await LocalNotifications.cancel({ notifications: [{ id: WAKE_ID }, { id: LIGHTS_OUT_ID }] });
}

// ─── Rating and sending the day ──────────────────────────────────────────────

/** Ask Apple for the in-app review dialog. Apple may ignore it. No-op in a browser. */
export async function requestAppReview(): Promise<void> {
  if (!isNative()) return;
  await AppReview.requestReview().catch(() => {});
}

/** Hand the day's result to the share sheet. Falls back to the clipboard. */
export async function shareText(text: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  try {
    const can = await Share.canShare();
    if (!can.value) throw new Error("unavailable");
    await Share.share({ title: "Velocity", text, dialogTitle: "Send today" });
    return "shared";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (/cancel|in progress|abort/i.test(message)) return "cancelled";
    if (!/unavailable|not available/i.test(message)) return "failed";
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      return "failed";
    }
  }
}

// ─── Support ─────────────────────────────────────────────────────────────────

/** Open a new email to support in the user's mail app. The address is never shown on screen. */
export async function emailSupport(): Promise<void> {
  if (!SUPPORT_EMAIL) return;
  const subject = encodeURIComponent(`Velocity ${APP_VERSION} support`);
  const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}`;
  if (isNative()) {
    await AppLauncher.openUrl({ url }).catch(() => {});
  } else {
    window.location.href = url;
  }
}
