"use client";

import { useState } from "react";
import { Brain, Dumbbell, Sunrise } from "lucide-react";
import { AppIcon } from "@/components/ui";
import { displayClock, minutesToClock, wakeWindowOpensAt } from "@/lib/velocity";

const PROMISE = [
  { icon: Sunrise, tint: "bg-amber-soft text-amber", title: "Wake on time", body: "A window, not a vague morning." },
  { icon: Dumbbell, tint: "bg-bad-soft text-bad", title: "Train", body: "Check in when you arrive. Getting there is the rep." },
  { icon: Brain, tint: "bg-calm-soft text-calm", title: "Deep work", body: "One block, timed. The phone stays in the other room." },
];

const DEEP_WORK = [60, 90, 120];

export function Onboarding({
  onComplete,
}: {
  onComplete: (input: { name: string; wakeTarget: string; deepWorkTargetMinutes: number }) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [wakeTarget, setWakeTarget] = useState("05:30");
  const [deepWork, setDeepWork] = useState(90);

  if (step === 0) {
    return (
      <main className="hero-card mx-auto flex min-h-dvh w-full max-w-[440px] flex-col rounded-none px-5 pb-[calc(env(safe-area-inset-bottom,0px)+28px)] pt-[calc(env(safe-area-inset-top,0px)+28px)]">
        <div className="relative z-10 flex flex-1 flex-col">
          <div className="flex items-center justify-between">
            <p className="dim text-[11px] font-semibold tracking-[0.28em]">VELOCITY</p>
            <p className="dim text-[13px] font-semibold tabular-nums">01 / 02</p>
          </div>
          <h1 className="mt-10 font-[family-name:var(--font-display)] text-[64px] italic leading-[0.88]">
            Three things.
            <br />
            Every day.
          </h1>
          <p className="dim mt-4 max-w-[18rem] text-[16px] leading-relaxed">
            The streak counts a day only when all three are done. Miss one and the day does not count.
          </p>
          <ul className="mt-8 flex flex-col gap-3">
            {PROMISE.map((item, i) => (
              <li key={item.title} className="glass-row flex items-center gap-3.5 px-4 py-4">
                <span className="w-8 shrink-0 font-[family-name:var(--font-display)] text-[24px] italic leading-none">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${item.tint}`}>
                  <item.icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-[16px] font-semibold">{item.title}</span>
                  <span className="mt-0.5 block text-[14px] leading-snug opacity-70">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-8">
            <button
              onClick={() => setStep(1)}
              className="h-12 w-full rounded-full bg-white text-[16px] font-semibold text-[#1a0c06] shadow-[0_12px_30px_rgba(0,0,0,0.22)] transition active:scale-[0.98]"
            >
              Set my standard
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-4 pb-[calc(env(safe-area-inset-bottom,0px)+28px)] pt-[calc(env(safe-area-inset-top,0px)+28px)]">
      <div className="flex items-center justify-between px-1">
        <AppIcon size={40} />
        <p className="text-[13px] font-semibold tabular-nums text-muted">02 / 02</p>
      </div>
      <div className="flex flex-1 flex-col pt-8">
          <h1 className="font-[family-name:var(--font-display)] text-[48px] italic leading-[0.95]">
            Set the standard.
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-muted">
            Day one is free. Once a day has started, a change waits until tomorrow, so the rules can't be bent to fit.
          </p>

          <label className="mt-8 block">
            <span className="px-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should Velocity call you?"
              maxLength={40}
              autoFocus
              className="mt-2 h-12 w-full rounded-[14px] bg-card px-4 text-[16px] text-ink outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>

          <label className="mt-5 block">
            <span className="px-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Wake target</span>
            <input
              type="time"
              value={wakeTarget}
              onChange={(e) => e.target.value && setWakeTarget(e.target.value)}
              aria-label="Wake target"
              className="mt-2 h-12 w-full rounded-[14px] bg-card px-4 text-[16px] font-semibold tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span className="mt-1.5 block px-1 text-[13px] text-muted">
              15 minutes of grace. The window opens at {displayClock(minutesToClock(wakeWindowOpensAt({ wakeTarget })))}.
            </span>
          </label>

          <div className="mt-5">
            <p className="px-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Deep work</p>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Deep work target">
              {DEEP_WORK.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={deepWork === m}
                  onClick={() => setDeepWork(m)}
                  className={`h-12 rounded-[14px] text-[15px] font-semibold tabular-nums transition ${
                    deepWork === m ? "btn-accent" : "card text-ink"
                  }`}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto pt-8">
            <button
              onClick={() => onComplete({ name, wakeTarget, deepWorkTargetMinutes: deepWork })}
              className="btn-accent h-12 w-full rounded-[14px] text-[16px] font-semibold transition active:scale-[0.98]"
            >
              Start day one
            </button>
          </div>
        </div>
    </main>
  );
}
