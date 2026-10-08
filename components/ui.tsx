import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[22px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{children}</h2>;
}

export function AppIcon({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <rect width="100" height="100" rx="22" fill="var(--color-accent)" />
      <path d="M56 14 26 58h20l-4 28 32-46H54z" fill="#fff" />
    </svg>
  );
}

/** Shared frame for secondary screens: back link, large title, content column. */
export function SubScreen({ title, back = { href: "/", label: "Today" }, children }: {
  title: string;
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[440px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+40px)] pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <Link href={back.href} className="hit flex w-fit items-center gap-0.5 py-2 text-[16px] font-medium text-accent">
        <ChevronLeft className="h-5 w-5" />
        {back.label}
      </Link>
      <h1 className="px-1 pb-6 pt-2 text-[34px] font-bold leading-none tracking-[-0.02em]">{title}</h1>
      {children}
    </main>
  );
}
