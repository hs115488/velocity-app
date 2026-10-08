import type { ReactNode } from "react";
import { Card, SubScreen } from "@/components/ui";
import { APP_NAME, PRIVACY_UPDATED } from "@/lib/app-config";

export const metadata = { title: `Privacy Policy · ${APP_NAME}` };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <SubScreen title="Privacy" back={{ href: "/settings", label: "Settings" }}>
      <Card className="flex max-w-[65ch] flex-col gap-6 p-5">
        <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Last updated {PRIVACY_UPDATED}</p>

        <Section title="The short version">
          <p>
            {APP_NAME} does not collect, store or share any personal information. Everything you record stays on your
            device.
          </p>
        </Section>

        <Section title="What the app stores">
          <p>
            Your wake-up logs, training check-ins, deep work sessions, tasks and settings are saved in the app&apos;s
            storage on your device. They are never sent to us or to anyone else.
          </p>
        </Section>

        <Section title="No accounts, analytics or ads">
          <p>
            {APP_NAME} has no sign-up, no tracking, no analytics, no advertising and no third-party data sharing.
          </p>
        </Section>

        <Section title="Notifications">
          <p>
            If you allow notifications, reminders are scheduled on your device. No notification content leaves your
            device.
          </p>
        </Section>

        <Section title="Focus mode">
          <p>
            If you turn on Focus during deep work, {APP_NAME} runs two shortcuts you create in Apple&apos;s Shortcuts app to
            turn your Focus on and off. {APP_NAME} cannot see your Focus settings or anything else in Shortcuts.
          </p>
        </Section>

        <Section title="Purchases">
          <p>
            Any purchase is handled entirely by Apple through the App Store. We never receive your payment details.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            Go to Settings and tap Delete all data, or delete the app. Either removes everything {APP_NAME} has stored.
          </p>
        </Section>

        <Section title="Children">
          <p>{APP_NAME} is not directed at children under 13 and collects no information from anyone.</p>
        </Section>

        <Section title="Changes">
          <p>If this policy changes, the date at the top will change and the new policy will be posted here.</p>
        </Section>

        <Section title="Contact">
          <p>Questions about this policy: go to Settings and tap Email support.</p>
        </Section>
      </Card>
    </SubScreen>
  );
}
