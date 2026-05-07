import { createFileRoute } from "@tanstack/react-router";
import { ConnectedAccounts } from "../../components/settings/connected-accounts.js";
import { CurrentPlan } from "../../components/settings/current-plan.js";
import { DangerZone } from "../../components/settings/danger-zone.js";
import { DisplayName } from "../../components/settings/display-name.js";
import { Email } from "../../components/settings/email.js";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
});

function Separator() {
  return <hr className="border-gray-800" />;
}

function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-8 text-2xl font-bold text-white">Settings</h1>

      <div className="space-y-8">
        <DisplayName />
        <Separator />
        <Email />
        <Separator />
        <ConnectedAccounts />
        <Separator />
        <CurrentPlan />
        <Separator />
        <DangerZone />
      </div>
    </div>
  );
}
