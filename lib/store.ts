// lib/store.ts
// The iPhone app buys Pro through StoreKit. A browser has no App Store,
// so the same plans are recorded on this device and the screen says so.

import { NativePurchases, PURCHASE_TYPE } from "@capgo/native-purchases";
import {
  entitlementFromStore,
  PRODUCTS,
  startTrial,
  subscribe,
  trialAvailable,
} from "@/lib/billing";
import { isNative } from "@/lib/native";
import type { Entitlement } from "@/types/velocity";
import type { Transaction } from "@capgo/native-purchases";

export type PurchaseOutcome =
  | { ok: true; entitlement: Entitlement }
  | { ok: false; message: string };

function cancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /cancel/i.test(message);
}

/** Trial only when StoreKit says so. A short remaining period is not a trial. */
export function sourceFromTransaction(tx: Transaction, previous?: Entitlement): "trial" | "paid" {
  if (tx.isTrialPeriod === true || tx.isInIntroPricePeriod === true) return "trial";
  if (tx.isTrialPeriod === false || tx.transactionReason === "renewal") return "paid";
  if (previous?.source === "trial" && previous.expiresAt && tx.expirationDate && previous.expiresAt === new Date(tx.expirationDate).toISOString()) {
    return "trial";
  }
  return "paid";
}

function activeSubscription(purchases: Transaction[]): Transaction | undefined {
  return purchases
    .filter((p) => p.isActive && p.expirationDate && !p.revocationDate)
    .sort((a, b) => new Date(b.expirationDate!).getTime() - new Date(a.expirationDate!).getTime())[0];
}

function fromTransaction(tx: Transaction, previous: Entitlement | undefined): Entitlement | null {
  if (!tx.expirationDate) return null;
  return entitlementFromStore(tx.productIdentifier, tx.expirationDate, sourceFromTransaction(tx, previous));
}

/** Buy the selected plan. Yearly starts the free trial when the store still offers it. */
export async function purchasePlan(
  productId: string,
  current: Entitlement | undefined,
  now: Date,
): Promise<PurchaseOutcome> {
  if (!isNative()) {
    const entitlement =
      productId === PRODUCTS.yearly.id && trialAvailable(current, now)
        ? startTrial(current, now)
        : subscribe(productId, now);
    return { ok: true, entitlement };
  }

  try {
    const tx = await NativePurchases.purchaseProduct({
      productIdentifier: productId,
      productType: PURCHASE_TYPE.SUBS,
    });
    if (tx.revocationDate) return { ok: false, message: "That purchase was refunded." };
    if (!tx.expirationDate) {
      return { ok: false, message: "The App Store didn't confirm an end date. Use Restore purchases." };
    }
    const entitlement = fromTransaction(tx, current);
    if (!entitlement) return { ok: false, message: "The App Store didn't confirm an end date. Use Restore purchases." };
    return { ok: true, entitlement };
  } catch (err) {
    if (cancelled(err)) return { ok: false, message: "" };
    return { ok: false, message: "The App Store couldn't complete that. Try again, or use Restore purchases." };
  }
}

/** Ask Apple for the subscription already on this Apple ID. */
export async function restorePlan(): Promise<PurchaseOutcome> {
  if (!isNative()) return { ok: false, message: "Restore purchases is in the iPhone app." };
  try {
    await NativePurchases.restorePurchases();
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS });
    const active = activeSubscription(purchases);
    const entitlement = active ? fromTransaction(active, undefined) : null;
    if (!entitlement) return { ok: false, message: "No active subscription was found for this Apple ID." };
    return { ok: true, entitlement };
  } catch {
    return { ok: false, message: "Couldn't reach the App Store. Try again." };
  }
}

export type SyncOutcome =
  | { status: "skip" }
  | { status: "keep" }
  | { status: "set"; entitlement: Entitlement };

/**
 * Replace the saved expiration with what StoreKit says right now.
 * A browser has no receipt, so the local demo entitlement is left alone.
 * If the store can't be reached, the saved entitlement stays until the next try.
 */
export async function syncPlan(current: Entitlement | undefined): Promise<SyncOutcome> {
  if (!isNative()) return { status: "skip" };
  try {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS });
    const active = activeSubscription(purchases);
    const entitlement = active ? fromTransaction(active, current) : null;
    if (entitlement) return { status: "set", entitlement };
    return {
      status: "set",
      entitlement: {
        productId: null,
        expiresAt: null,
        trialUsed: current?.trialUsed === true || !!current?.productId,
      },
    };
  } catch {
    return { status: "keep" };
  }
}

export type StoreOffers = {
  prices: Partial<Record<string, string>>;
  /** False when this Apple ID has already used the intro offer, or the store didn't confirm one. */
  trialEligible: boolean;
};

/** Live prices and whether the yearly intro offer is still available. Null in a browser. */
export async function loadStoreOffers(): Promise<StoreOffers | null> {
  if (!isNative()) return null;
  try {
    const [{ products }, { purchases }] = await Promise.all([
      NativePurchases.getProducts({
        productIdentifiers: [PRODUCTS.yearly.id, PRODUCTS.monthly.id],
        productType: PURCHASE_TYPE.SUBS,
      }),
      NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS }),
    ]);
    const yearly = products.find((p) => p.identifier === PRODUCTS.yearly.id);
    const used = purchases.some(
      (p) => p.productIdentifier === PRODUCTS.yearly.id || p.productIdentifier === PRODUCTS.monthly.id,
    );
    const prices: StoreOffers["prices"] = {};
    for (const product of products) {
      if (product.priceString) prices[product.identifier] = product.priceString;
    }
    return { prices, trialEligible: !used && yearly?.introductoryPrice?.price === 0 };
  } catch {
    return { prices: {}, trialEligible: false };
  }
}
