import { ConnectedAccounts } from "@/components/settings/connected-accounts.js";
import { CurrentPlan } from "@/components/settings/current-plan.js";
import { DangerZone } from "@/components/settings/danger-zone.js";
import { DisplayName } from "@/components/settings/display-name.js";
import { Email } from "@/components/settings/email.js";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
});

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <h2
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          {title}
        </h2>
      </div>
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

function SettingsPage() {
  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "40px 24px",
      }}
    >
      <h1
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: "var(--color-text-primary)",
          marginBottom: 28,
          margin: "0 0 28px",
        }}
      >
        Settings
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Section title="Profile">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <DisplayName />
            <Email />
          </div>
        </Section>

        <Section title="Connected Accounts">
          <ConnectedAccounts />
        </Section>

        <Section title="Subscription">
          <CurrentPlan />
        </Section>

        <Section title="Danger Zone">
          <DangerZone />
        </Section>
      </div>
    </div>
  );
}
