"use client";

import { useState } from "react";
import { Card, SectionLabel } from "@/components/ui";
import { shareText } from "@/lib/native";
import { dayReport } from "@/lib/report";
import type { ExecutionGrade } from "@/types/velocity";

export function DayShare({
  dateLabel,
  executed,
  grade,
  streak,
  wake,
  gym,
  deepWork,
  partnerName,
  onPartner,
}: {
  dateLabel: string;
  executed: boolean;
  grade: ExecutionGrade;
  streak: number;
  wake: boolean;
  gym: boolean;
  deepWork: boolean;
  partnerName: string;
  onPartner: (name: string) => void;
}) {
  const [name, setName] = useState(partnerName);
  const [status, setStatus] = useState<"" | "shared" | "copied" | "failed">("");
  const marks = [
    { label: "Wake", done: wake },
    { label: "Train", done: gym },
    { label: "Deep work", done: deepWork },
  ];

  const send = async () => {
    onPartner(name);
    const result = await shareText(
      dayReport({ dateLabel, executed, grade, streak, wake, gym, deepWork, partnerName: name }),
    );
    if (result === "cancelled") return;
    setStatus(result);
  };

  return (
    <section>
      <SectionLabel>One person</SectionLabel>
      <Card className="p-5">
        <p className="font-[family-name:var(--font-display)] text-[32px] italic leading-none">
          {executed ? "Day executed." : "Missed."}
        </p>
        <p className="mt-1 text-[14px] tabular-nums text-muted">
          Streak {streak}
          {grade !== "NEW" ? ` · ${grade.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : ""}
        </p>
        <ul className="mt-4 flex gap-2">
          {marks.map((mark) => (
            <li
              key={mark.label}
              className={`rounded-full px-3 py-1 text-[13px] font-semibold ${mark.done ? "bg-good-soft text-good" : "bg-fill text-muted"}`}
            >
              {mark.label}
            </li>
          ))}
        </ul>
        <label className="mt-4 block">
          <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Send it to</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onPartner(name)}
            placeholder="One name"
            maxLength={40}
            aria-label="Person who sees this day"
            className="mt-2 h-11 w-full rounded-[12px] bg-fill px-3 text-[16px] text-ink outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <button
          type="button"
          onClick={() => void send()}
          className="btn-accent mt-3 flex h-11 w-full items-center justify-center rounded-[14px] text-[15px] font-semibold transition active:scale-[0.98]"
        >
          {name.trim() ? `Send to ${name.trim()}` : "Send today"}
        </button>
        {status && (
          <p className={`mt-2 text-[13px] ${status === "failed" ? "text-bad" : "text-muted"}`}>
            {status === "copied" ? "Copied. Paste it to them." : status === "failed" ? "Couldn't send that from here." : "Sent."}
          </p>
        )}
      </Card>
    </section>
  );
}
