import type { ReactNode } from "react";
import { Card, SubScreen } from "@/components/ui";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/app-config";
import { PRODUCTS, TRIAL_DAYS } from "@/lib/billing";

export const metadata = { title: `Terms · ${APP_NAME}` };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <SubScreen title="Terms" back={{ href: "/settings", label: "Settings" }}>
      <Card className="flex max-w-[65ch] flex-col gap-6 p-5">
        <Section title="The agreement">
          <p>
            {APP_NAME} is a habit app. You keep the wake-up, training, and deep work log on this device. Using the app
            means you agree to these terms and the privacy policy.
          </p>
        </Section>

        <Section title="Subscriptions">
          <p>
            Velocity Pro is optional. The yearly plan is {PRODUCTS.yearly.price} per year and includes a {TRIAL_DAYS}-day
            free trial for new subscribers. The monthly plan is {PRODUCTS.monthly.price} per month. Prices are in US
            dollars and may differ by country in the App Store.
          </p>
          <p>
            Payment is charged to your Apple ID when you confirm. A subscription renews automatically unless you cancel
            at least 24 hours before the end of the current period. Your account is charged for renewal within 24 hours
            before the period ends. Any unused portion of a free trial is forfeited when you buy a subscription, where
            Apple applies that rule.
          </p>
          <p>
            Manage or cancel in Settings on your iPhone: tap your name, then Subscriptions. Deleting {APP_NAME} does not
            cancel the subscription.
          </p>
        </Section>

        <Section title="What stays free">
          <p>
            Logging a wake-up, a training check-in, and deep work, plus today's streak, does not require Pro. Pro adds
            the full task list, coach patterns, reminders, and Focus.
          </p>
        </Section>

        <Section title="Your data">
          <p>
            Logs stay on your device. {APP_NAME} does not operate an account. Deleting all data in Settings, or deleting
            the app, removes what is stored here. An App Store subscription is canceled only through Apple.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions: <a className="text-accent" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </Section>
      </Card>
    </SubScreen>
  );
}
