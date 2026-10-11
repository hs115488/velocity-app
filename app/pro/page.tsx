"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useVelocity } from "@/hooks/use-velocity";
import { Card, SubScreen } from "@/components/ui";
import { isPro, PRODUCTS, PRO_FEATURES, trialAvailable, trialEndsSoon, yearlySavings, type ProductId } from "@/lib/billing";
import { isNative } from "@/lib/native";
import { loadStoreOffers, purchasePlan, restorePlan } from "@/lib/store";

function formatEnds(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default function ProPage() {
  const { hydrated, entitlement, actions } = useVelocity();
  const [plan, setPlan] = useState<ProductId>(PRODUCTS.yearly.id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [prices, setPrices] = useState<Partial<Record<string, string>>>({});
  const [storeTrial, setStoreTrial] = useState<boolean | null>(null);
  const now = new Date();
  const pro = isPro(entitlement, now);
  const ending = trialEndsSoon(entitlement, now);
  const trial = trialAvailable(entitlement, now) && storeTrial === true;

  useEffect(() => {
    if (!isNative()) {
      setStoreTrial(true);
      return;
    }
    let live = true;
    void loadStoreOffers().then((offers) => {
      if (!live) return;
      setStoreTrial(offers?.trialEligible === true);
      setPrices(offers?.prices ?? {});
    });
    return () => {
      live = false;
    };
  }, []);
  const savings = yearlySavings();

  if (!hydrated) return <div className="min-h-dvh bg-bg" />;

  const subscribe = async () => {
    setBusy(true);
    setNote("");
    const result = await purchasePlan(plan, entitlement, new Date());
    setBusy(false);
    if (result.ok) actions.applyEntitlement(result.entitlement);
    else setNote(result.message);
  };

  const restore = async () => {
    setBusy(true);
    setNote("");
    const result = await restorePlan();
    setBusy(false);
    if (result.ok) actions.applyEntitlement(result.entitlement);
    else setNote(result.message);
  };

  return (
    <SubScreen title="Pro">
      <div className="flex flex-col gap-7">
        <section>
          <h2 className="px-1 font-[family-name:var(--font-display)] text-[40px] italic leading-[1.02]">
            {ending ? "Your wake reminder stops with the trial." : pro ? "You're on Pro." : "Protect tomorrow's streak."}
          </h2>
          <p className="mt-2 px-1 text-[16px] leading-relaxed text-muted">
            {ending
              ? `The trial runs through ${entitlement?.expiresAt ? formatEnds(entitlement.expiresAt) : "tomorrow"}. Yearly keeps lights out and the wake alarm.`
              : pro
                ? `Access runs through ${entitlement?.expiresAt ? formatEnds(entitlement.expiresAt) : "this period"}. Wake, train, and deep work stay the whole point.`
                : "Wake, train, and deep work stay free. Pro is the lights-out reminder and the wake alarm that keep the streak from depending on memory."}
          </p>
        </section>

        {pro && !ending ? (
          <p className="px-1 text-[14px] leading-relaxed text-muted">
            {isNative()
              ? "To cancel a renewal, open Settings on your iPhone, tap your name, then Subscriptions. Deleting the app does not cancel it."
              : "This browser keeps the plan on this device. There is nothing to cancel with Apple."}
          </p>
        ) : (
          <PurchaseOffer
            plan={plan}
            setPlan={setPlan}
            prices={prices}
            trial={trial}
            savings={savings}
            busy={busy}
            note={note}
            onSubscribe={() => void subscribe()}
            onRestore={() => void restore()}
          />
        )}

        <Card className="divide-y divide-line overflow-hidden">
          {PRO_FEATURES.map((feature, i) => (
            <div key={feature.title} className="flex gap-3 px-4 py-4">
              <span className="w-8 shrink-0 font-[family-name:var(--font-display)] text-[22px] italic leading-none text-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="text-[16px] font-semibold">{feature.title}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-muted">{feature.body}</p>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </SubScreen>
  );
}

function PurchaseOffer({
  plan,
  setPlan,
  prices,
  trial,
  savings,
  busy,
  note,
  onSubscribe,
  onRestore,
}: {
  plan: ProductId;
  setPlan: (id: ProductId) => void;
  prices: Partial<Record<string, string>>;
  trial: boolean;
  savings: { monthlyYear: number; saved: number };
  busy: boolean;
  note: string;
  onSubscribe: () => void;
  onRestore: () => void;
}) {
  const yearly = plan === PRODUCTS.yearly.id;
  return (
    <>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Plan">
        {([PRODUCTS.yearly, PRODUCTS.monthly] as const).map((product) => {
          const selected = plan === product.id;
          return (
            <button
              key={product.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={product.period === "year" ? "Yearly plan" : "Monthly plan"}
              onClick={() => setPlan(product.id)}
              className={`rounded-[22px] px-4 py-4 text-left transition ${selected ? "btn-accent" : "card text-ink"}`}
            >
              <span className="block text-[13px] font-semibold uppercase tracking-[0.06em] opacity-70">{product.title}</span>
              <span className="mt-1 block text-[22px] font-bold tracking-[-0.02em] tabular-nums">{prices[product.id] ?? product.price}</span>
              <span className={`mt-1 block text-[13px] ${selected ? "text-current" : "text-muted"}`}>
                {product.period === "year"
                  ? trial
                    ? `${product.trialDays} days free · save $${savings.saved}`
                    : `Save $${savings.saved} vs monthly`
                  : `${product.perMonth}/mo · $${savings.monthlyYear.toFixed(2)}/yr`}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onSubscribe}
        disabled={busy}
        className="btn-accent h-12 w-full rounded-[14px] text-[16px] font-semibold transition active:scale-[0.98] disabled:opacity-50"
      >
        {yearly && trial ? "Start 7-day free trial" : `Subscribe ${yearly ? "yearly" : "monthly"}`}
      </button>
      <button
        type="button"
        onClick={onRestore}
        disabled={busy}
        className="h-11 w-full text-[14px] font-semibold text-accent disabled:opacity-50"
      >
        Restore purchases
      </button>
      {note && <p className="px-1 text-[13px] leading-snug text-bad">{note}</p>}
      {!isNative() && (
        <p className="px-1 text-[13px] leading-relaxed text-muted">
          On iPhone this charges your Apple ID. This browser keeps the plan on this device.
        </p>
      )}
      <p className="px-1 text-[13px] leading-relaxed text-muted">
        {`Velocity Pro Yearly is ${PRODUCTS.yearly.price} per year${trial ? ` after a ${PRODUCTS.yearly.trialDays}-day free trial` : ""}. Velocity Pro Monthly is ${PRODUCTS.monthly.price} per month. Payment is charged to your Apple ID when you confirm. The plan renews automatically unless you cancel at least 24 hours before the period ends. Manage or cancel in iPhone Settings, your name, Subscriptions.`}
      </p>
      <p className="px-1 text-[13px] leading-relaxed text-muted">
        <Link href="/terms" className="font-semibold text-accent">Terms</Link>
        {" · "}
        <Link href="/privacy" className="font-semibold text-accent">Privacy</Link>
        {" · "}
        <Link href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" className="font-semibold text-accent">
          Apple standard EULA
        </Link>
      </p>
    </>
  );
}
