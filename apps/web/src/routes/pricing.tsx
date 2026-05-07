// Pricing page — auth optional (SPEC §12)
// CTA buttons are intentional no-ops in this prototype.
// Do not "fix" the empty onClick handlers — they are correct per spec.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminBanner } from "../components/pricing/AdminBanner.js";
import { IntervalToggle } from "../components/pricing/IntervalToggle.js";
import { PlanCard } from "../components/pricing/PlanCard.js";
import { fetchMe } from "../lib/auth.js";
import { type BillingInterval, PLANS } from "../lib/plans.js";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });

  const isAdmin = me?.tier === "admin";

  // Compute active tier only when me is loaded; avoid flicker per design doc
  const activeTier =
    me && !isAdmin && ["free", "creator", "pro"].includes(me.tier) ? me.tier : null;

  return (
    <div className="min-h-screen bg-gray-950 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        {/* Page heading */}
        <div className="mb-12 text-center">
          <h1 className="font-mono text-3xl font-bold text-white">Plans &amp; Pricing</h1>
          <p className="mt-3 text-sm text-gray-500">Upgrade any time. Credits reset monthly.</p>
        </div>

        {/* Admin banner */}
        {isAdmin && <AdminBanner />}

        {/* Interval toggle */}
        <div className="mb-10 flex justify-center">
          <IntervalToggle value={interval} onChange={setInterval} />
        </div>

        {/* Plan cards grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              interval={interval}
              isActive={plan.id === activeTier}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
