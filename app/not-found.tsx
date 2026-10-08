import Link from "next/link";
import { AppIcon } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center px-6 text-center">
      <AppIcon size={56} />
      <h1 className="mt-6 text-[24px] font-bold tracking-[-0.01em]">Page not found</h1>
      <p className="mt-2 text-[15px] text-muted">This screen doesn&apos;t exist.</p>
      <Link
        href="/"
        className="mt-6 flex h-11 items-center rounded-[14px] bg-ink px-6 text-[15px] font-semibold text-bg transition active:scale-[0.98]"
      >
        Back to Today
      </Link>
    </main>
  );
}
