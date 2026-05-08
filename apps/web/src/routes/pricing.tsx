// Pricing page — auth optional (SPEC §12)
// CTA buttons are intentional no-ops in this prototype.
// Do not "fix" the empty onClick handlers — they are correct per spec.
import { type BillingInterval, PLANS } from "@arcadeai/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminBanner } from "../components/pricing/AdminBanner.js";
import { IntervalToggle } from "../components/pricing/IntervalToggle.js";
import { PlanCard } from "../components/pricing/PlanCard.js";
import { fetchMe } from "../lib/auth.js";

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

  const activeTier =
    me && !isAdmin && ["free", "creator", "pro"].includes(me.tier) ? me.tier : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        padding: "64px 24px",
        position: "relative",
      }}
    >
      {/* Background grid */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(124,58,237,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.03) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          pointerEvents: "none",
        }}
      />

      <div style={{ maxWidth: 960, margin: "0 auto", position: "relative" }}>
        {/* Back link (if not authed, show standalone header; if authed, top bar handles nav) */}
        {!me && (
          <div style={{ marginBottom: 32 }}>
            <Link
              to="/sign-in"
              style={{
                fontSize: 13,
                color: "var(--color-text-muted)",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M9 11L5 7l4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Back to sign in
            </Link>
          </div>
        )}

        {/* Heading */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              marginBottom: 12,
              background: "linear-gradient(135deg, #e8e8f0 0%, #7878a0 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Plans &amp; Pricing
          </h1>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            Upgrade any time. Credits reset monthly.
          </p>
        </div>

        {isAdmin && <AdminBanner />}

        {/* Interval toggle */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 40 }}>
          <IntervalToggle value={interval} onChange={setInterval} />
        </div>

        {/* Plan cards laid out left-to-right — 4 across on wide viewports,
            wraps to fit smaller screens. The inline grid takes precedence
            over any Tailwind class so we use a single inline declaration. */}
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            alignItems: "stretch",
          }}
        >
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
