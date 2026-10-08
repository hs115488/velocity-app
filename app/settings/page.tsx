"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useVelocity } from "@/hooks/use-velocity";
import { Card, SectionLabel, SubScreen } from "@/components/ui";
import { APP_VERSION, SUPPORT_EMAIL } from "@/lib/app-config";
import { lightsOut } from "@/lib/playbook";
import { canChangeStandardToday, displayClock, upcomingStandard } from "@/lib/velocity";
import { disableReminders, emailSupport, enableReminders, isNative, remindersEnabled, scheduleReminders } from "@/lib/native";
import { FOCUS_SHORTCUTS, focusEnabled, openShortcutsEditor, runFocus, setFocusEnabled } from "@/lib/focus";

function CopyName({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(name);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard refused: the name stays selectable on screen.
        }
      }}
      className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-[10px] bg-fill px-3 py-2 text-left"
    >
      <span className="select-all text-[14px] font-semibold text-ink">{name}</span>
      <span className="shrink-0 text-[13px] font-semibold text-accent">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`hit relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${on ? "bg-good" : "bg-fill"}`}
    >
      <span
        className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-[left] ${on ? "left-[22px]" : "left-[2px]"}`}
      />
    </button>
  );
}

const GRACE_OPTIONS = [10, 15, 20, 30];
const DEEP_WORK_OPTIONS = [60, 90, 120, 180];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[16px]">{label}</p>
        {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const selectClass =
  "h-11 shrink-0 appearance-none rounded-[12px] bg-fill px-3 text-[15px] font-semibold tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";

export default function SettingsPage() {
  const router = useRouter();
  const { hydrated, profile, todayLog, actions } = useVelocity();
  // What the user has chosen: today's standard, or the change queued for tomorrow.
  const chosen = upcomingStandard(profile);
  const [confirming, setConfirming] = useState(false);
  const [native, setNative] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [remindersDenied, setRemindersDenied] = useState(false);

  const [focus, setFocus] = useState(false);

  useEffect(() => {
    setNative(isNative());
    setReminders(remindersEnabled());
    setFocus(focusEnabled());
  }, []);

  const toggleFocus = (on: boolean) => {
    setFocusEnabled(on);
    setFocus(on);
  };

  // Keep scheduled reminders in step with the wake target.
  useEffect(() => {
    if (hydrated && reminders) scheduleReminders(chosen).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reminders, chosen.wakeTarget, chosen.wakeGraceMinutes]);

  const toggleReminders = async (on: boolean) => {
    if (on) {
      const granted = await enableReminders(profile).catch(() => false);
      setReminders(granted);
      setRemindersDenied(!granted);
    } else {
      await disableReminders().catch(() => {});
      setReminders(false);
    }
  };

  if (!hydrated) return <div className="min-h-dvh bg-bg" />;

  return (
    <SubScreen title="Settings">
      <div className="flex flex-col gap-7">
        <section>
          <SectionLabel>Your standard</SectionLabel>
          <Card className="divide-y divide-line overflow-hidden">
            <Row label="Wake target" hint="The time you commit to being up">
              <input
                type="time"
                value={chosen.wakeTarget}
                onChange={(e) => e.target.value && actions.updateProfile({ wakeTarget: e.target.value })}
                className={selectClass}
                aria-label="Wake target"
              />
            </Row>
            <Row label="Grace period" hint="How late still counts">
              <select
                value={chosen.wakeGraceMinutes}
                onChange={(e) => actions.updateProfile({ wakeGraceMinutes: Number(e.target.value) })}
                className={selectClass}
                aria-label="Grace period"
              >
                {GRACE_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </Row>
            <Row label="Deep work target" hint="Daily focused minutes">
              <select
                value={chosen.deepWorkTargetMinutes}
                onChange={(e) => actions.updateProfile({ deepWorkTargetMinutes: Number(e.target.value) })}
                className={selectClass}
                aria-label="Deep work target"
              >
                {DEEP_WORK_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`}</option>
                ))}
              </select>
            </Row>
          </Card>
          <p className="px-1 pt-2 text-[13px] leading-snug text-muted">
            {profile.pending ? (
              <>
                <span className="font-semibold text-ink">Starts tomorrow.</span> Today keeps the standard it began with:
                wake by {displayClock(profile.wakeTarget)}, {profile.deepWorkTargetMinutes} min of deep work.
              </>
            ) : canChangeStandardToday(todayLog, profile, new Date()) ? (
              "Nothing is logged yet today, so changes apply right away."
            ) : (
              "Today is underway, so changes start tomorrow. A day can't be re-judged after the fact."
            )}
          </p>
        </section>

        {native && (
          <section>
            <SectionLabel>Reminders</SectionLabel>
            <Card className="overflow-hidden">
              <Row label="Daily reminders" hint={`Wake-up at ${displayClock(chosen.wakeTarget)}, lights out at ${displayClock(lightsOut(chosen))}`}>
                <Toggle on={reminders} onChange={toggleReminders} label="Daily reminders" />
              </Row>
            </Card>
            {remindersDenied && (
              <p className="px-1 pt-2 text-[13px] leading-snug text-bad">
                Notifications are off for Velocity. Turn them on in the iPhone Settings app, then try again.
              </p>
            )}
          </section>
        )}

        {native && (
          <section>
            <SectionLabel>Focus mode</SectionLabel>
            <Card className="overflow-hidden">
              <Row label="Focus during deep work" hint="Silences your phone while the timer runs">
                <Toggle on={focus} onChange={toggleFocus} label="Focus during deep work" />
              </Row>
              {focus && (
                <div className="border-t border-line px-4 pb-4 pt-3.5">
                  <p className="text-[14px] leading-relaxed text-muted">
                    iPhone only lets Shortcuts turn Focus on, so Velocity uses two shortcuts. Set them up once:
                  </p>
                  <ol className="mt-3 flex flex-col gap-4 text-[14px] leading-relaxed">
                    <li>
                      <p>
                        <span className="font-semibold">1.</span> In Shortcuts, create a shortcut with the{" "}
                        <span className="font-semibold">Set Focus</span> action: choose your Focus (Do Not Disturb or
                        Work), <span className="font-semibold">Turn On</span>, until turned off. Name it:
                      </p>
                      <CopyName name={FOCUS_SHORTCUTS.on} />
                    </li>
                    <li>
                      <p>
                        <span className="font-semibold">2.</span> Create a second one with{" "}
                        <span className="font-semibold">Set Focus</span> set to{" "}
                        <span className="font-semibold">Turn Off</span>. Name it:
                      </p>
                      <CopyName name={FOCUS_SHORTCUTS.off} />
                    </li>
                    <li>
                      <p>
                        <span className="font-semibold">3.</span> Test both below. If iPhone asks to open Shortcuts,
                        allow it.
                      </p>
                    </li>
                  </ol>
                  <button
                    onClick={openShortcutsEditor}
                    className="mt-4 flex h-11 w-full items-center justify-center rounded-[14px] bg-ink text-[15px] font-semibold text-bg transition active:scale-[0.98]"
                  >
                    Open Shortcuts
                  </button>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => runFocus("on", true)}
                      className="h-11 rounded-[14px] bg-fill text-[15px] font-semibold transition active:scale-[0.98]"
                    >
                      Test on
                    </button>
                    <button
                      onClick={() => runFocus("off", true)}
                      className="h-11 rounded-[14px] bg-fill text-[15px] font-semibold transition active:scale-[0.98]"
                    >
                      Test off
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </section>
        )}

        <section>
          <SectionLabel>Your data</SectionLabel>
          <Card className="overflow-hidden">
            <p className="px-4 pt-4 text-[14px] leading-relaxed text-muted">
              Everything Velocity records stays on this device. Nothing is uploaded.
            </p>
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                className="w-full px-4 py-3.5 text-left text-[16px] font-medium text-bad"
              >
                Delete all data
              </button>
            ) : (
              <div className="px-4 pb-4 pt-3">
                <p className="text-[15px] font-semibold">Delete your streak, history and settings?</p>
                <p className="mt-1 text-[14px] text-muted">This can&apos;t be undone.</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setConfirming(false)}
                    className="h-11 rounded-[14px] bg-fill text-[15px] font-semibold transition active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      actions.resetAll();
                      disableReminders().catch(() => {});
                      setFocusEnabled(false);
                      router.push("/");
                    }}
                    className="h-11 rounded-[14px] bg-bad text-[15px] font-semibold text-white transition active:scale-[0.98]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </Card>
        </section>

        <section>
          <SectionLabel>About</SectionLabel>
          <Card className="divide-y divide-line overflow-hidden">
            <Link href="/privacy" className="flex items-center justify-between px-4 py-3.5 text-[16px]">
              Privacy policy
              <ChevronRight className="h-4 w-4 text-faint" />
            </Link>
            {SUPPORT_EMAIL && (
              <button
                onClick={() => void emailSupport()}
                className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[16px]"
              >
                Email support
                <ChevronRight className="h-4 w-4 text-faint" />
              </button>
            )}
            <Row label="Version">
              <span className="text-[15px] tabular-nums text-muted">{APP_VERSION}</span>
            </Row>
          </Card>
        </section>
      </div>
    </SubScreen>
  );
}
