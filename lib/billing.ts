// lib/billing.ts
// What Pro costs and who has it. Pure: no StoreKit calls, no React.
// Product ids are the subscriptions to create in App Store Connect.
// The iPhone app purchases them in lib/store.ts. A browser keeps the
// same entitlement on device so the day can still be reviewed.

import type { Entitlement } from "@/types/velocity";

export const FREE_TASK_LIMIT = 1;
export const TRIAL_DAYS = 7;
/** The last stretch of a trial, long enough to cover the night before it ends. */
const TRIAL_WARNING_MS = 36 * 60 * 60 * 1000;

export const YEARLY_USD = 39.99;
export const MONTHLY_USD = 6.99;

export const PRODUCTS = {
  yearly: {
    id: "velocity.pro.yearly",
    title: "Yearly",
    price: "$39.99",
    period: "year" as const,
    perMonth: "$3.33",
    trialDays: TRIAL_DAYS,
  },
  monthly: {
    id: "velocity.pro.monthly",
    title: "Monthly",
    price: "$6.99",
    period: "month" as const,
    perMonth: "$6.99",
    trialDays: 0,
  },
} as const;

export type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS]["id"];

export const PRO_FEATURES = [
  { title: "Lights out and the wake reminder", body: "The alarm inside your window, and lights-out at the time that protects tomorrow's streak." },
  { title: "The full task list", body: "Name every block, time it, and bring yesterday's unfinished work forward." },
  { title: "The coach's patterns", body: "See the weak link, the weekday you miss, and when your wake-up is drifting." },
] as const;

/** What twelve months of the monthly plan costs, and how much the yearly plan saves. */
export function yearlySavings(): { monthlyYear: number; saved: number } {
  const monthlyYear = Math.round(MONTHLY_USD * 12 * 100) / 100;
  const saved = Math.round(monthlyYear - YEARLY_USD);
  return { monthlyYear, saved };
}

const DAY_MS = 86_400_000;

export function defaultEntitlement(): Entitlement {
  return { productId: null, expiresAt: null, trialUsed: false };
}

export function isPro(entitlement: Entitlement | undefined, now: Date): boolean {
  if (!entitlement?.expiresAt) return false;
  const ends = new Date(entitlement.expiresAt).getTime();
  return Number.isFinite(ends) && ends > now.getTime();
}

export function trialAvailable(entitlement: Entitlement | undefined, now: Date): boolean {
  return !isPro(entitlement, now) && !entitlement?.trialUsed;
}

export function canAddTask(taskCount: number, entitlement: Entitlement | undefined, now: Date): boolean {
  return isPro(entitlement, now) || taskCount < FREE_TASK_LIMIT;
}

/** The free plan can run the first saved task. Tasks added during Pro stay, and wait. */
export function canStartTask(index: number, entitlement: Entitlement | undefined, now: Date): boolean {
  return isPro(entitlement, now) || index < FREE_TASK_LIMIT;
}

/** True on the last night of a trial, while Pro is still on. */
export function trialEndsSoon(entitlement: Entitlement | undefined, now: Date): boolean {
  if (entitlement?.source !== "trial" || !entitlement.expiresAt || !isPro(entitlement, now)) return false;
  const left = new Date(entitlement.expiresAt).getTime() - now.getTime();
  return left > 0 && left <= TRIAL_WARNING_MS;
}

export function productById(id: string) {
  return Object.values(PRODUCTS).find((p) => p.id === id) ?? null;
}

function grant(productId: string, days: number, now: Date, source: "trial" | "paid"): Entitlement {
  return {
    productId,
    expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
    trialUsed: true,
    source,
  };
}

/** Seven days of Pro. Refuses a second trial. */
export function startTrial(entitlement: Entitlement | undefined, now: Date): Entitlement {
  if (entitlement?.trialUsed) return entitlement ?? defaultEntitlement();
  return grant(PRODUCTS.yearly.id, TRIAL_DAYS, now, "trial");
}

/** A paid period. Marks the trial as used so it can't be claimed afterward. */
export function subscribe(productId: string, now: Date): Entitlement {
  const product = productById(productId) ?? PRODUCTS.yearly;
  const days = product.period === "year" ? 365 : 30;
  return grant(product.id, days, now, "paid");
}

/**
 * Turn an App Store expiration into the entitlement the rest of the app reads.
 * `source` comes from the transaction (trial flag or renewal), never from how
 * many days are left. A paid year in its last week is still paid.
 */
export function entitlementFromStore(productId: string, expiresAt: string, source: "trial" | "paid"): Entitlement {
  const ends = new Date(expiresAt).getTime();
  return {
    productId: productById(productId)?.id ?? productId,
    expiresAt: new Date(ends).toISOString(),
    trialUsed: true,
    source,
  };
}
