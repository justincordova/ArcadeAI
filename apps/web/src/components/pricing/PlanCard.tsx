// Pricing-page plan card. Vertically-oriented card displayed alongside its
// siblings in a left-to-right row on the pricing page.
//
// Yearly pricing: shows the discounted per-month price next to a strike-
// through of the regular monthly price, then a "billed yearly" footnote.

import {
  type BillingInterval,
  PLAN_PRICES,
  type PlanCopy,
  TIER_CREDIT_LIMITS,
} from "@arcadeai/shared";
import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "@/components/ui/sonner.js";

interface PlanCardProps {
  plan: PlanCopy;
  interval: BillingInterval;
  isActive: boolean;
}

// Per SPEC §12 the CTAs are intentional no-ops in this prototype. Showing
// nothing on click feels broken though; surface a toast that explains the
// state without lying about what we'd do. Active-tier and Enterprise get
// dedicated copy.
function ctaToastMessage(planId: string, isActive: boolean): string {
  if (isActive) return "You're already on this plan.";
  if (planId === "enterprise")
    return "Contact sales is coming soon — for now, reach out via email.";
  if (planId === "free") return "You're already on the free tier (or close to it).";
  return "Billing isn't enabled yet — paid plans launch soon.";
}

const PLAN_ACCENTS: Record<string, { gradient: string; border: string; glow: string }> = {
  free: {
    gradient: "var(--gradient-brand)",
    border: "rgba(255,62,165,0.3)",
    glow: "rgba(255,62,165,0.08)",
  },
  creator: {
    gradient: "var(--gradient-brand)",
    border: "rgba(255,62,165,0.3)",
    glow: "rgba(255,62,165,0.08)",
  },
  pro: {
    gradient: "var(--gradient-brand)",
    border: "rgba(255,62,165,0.35)",
    glow: "rgba(255,62,165,0.08)",
  },
  enterprise: {
    gradient: "var(--gradient-brand)",
    border: "rgba(255,62,165,0.3)",
    glow: "rgba(255,62,165,0.06)",
  },
};

export function PlanCard({ plan, interval, isActive }: PlanCardProps) {
  const [hovered, setHovered] = useState(false);
  const prices = PLAN_PRICES[plan.id];
  const credits = plan.id === "enterprise" ? null : TIER_CREDIT_LIMITS[plan.id];
  const accent = PLAN_ACCENTS[plan.id] ?? PLAN_ACCENTS.enterprise;
  const active = isActive || hovered;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        border: `1px solid ${active ? accent.border : "var(--color-border)"}`,
        background: active
          ? `linear-gradient(160deg, ${accent.glow} 0%, var(--color-surface) 60%)`
          : "var(--color-surface)",
        padding: "24px 20px 20px",
        transition: "all 0.2s",
        boxShadow: active
          ? `0 0 24px ${accent.glow}, 0 6px 20px rgba(0,0,0,0.25)`
          : "0 2px 12px rgba(0,0,0,0.18)",
        height: "100%",
      }}
    >
      {/* Active pill — top-right corner */}
      {isActive && (
        <span
          style={{
            position: "absolute",
            right: 14,
            top: 14,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "2px 7px",
            borderRadius: 9999,
            border: `1px solid ${accent.border}`,
            color: "var(--color-text-secondary)",
          }}
        >
          ACTIVE
        </span>
      )}

      {/* Plan name — small uppercase label, gradient via text-clip */}
      <h3
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.06em",
          marginBottom: 14,
          backgroundImage: accent.gradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        {plan.name.toUpperCase()}
      </h3>

      {/* Price */}
      <div style={{ marginBottom: 4 }}>
        <PriceDisplay prices={prices} interval={interval} />
      </div>

      {credits ? (
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-secondary)",
            marginBottom: 20,
          }}
        >
          {credits.monthly.toLocaleString()} credits / month
        </p>
      ) : (
        <div style={{ marginBottom: 20 }} />
      )}

      {/* Feature list — fills remaining space */}
      <ul
        style={{
          flex: 1,
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 9,
        }}
      >
        {plan.features.map((f) => (
          <li
            key={f}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 13,
              color: "var(--color-text-secondary)",
              lineHeight: 1.45,
            }}
          >
            <Check
              size={13}
              strokeWidth={2.4}
              style={{
                flexShrink: 0,
                marginTop: 2,
                color: "var(--color-success)",
              }}
            />
            {f}
          </li>
        ))}
      </ul>

      {/* CTA — solid gradient button. Text uses plain white so it can never
          go invisible from text-clip + background interaction (the bug fix:
          the previous version set both `background` and `backgroundImage`
          on the same element with `text-clip`, which the shorthand reset
          on hover, wiping out the gradient and leaving transparent text). */}
      <button
        type="button"
        onClick={() => toast(ctaToastMessage(plan.id, isActive))}
        style={{
          marginTop: 22,
          width: "100%",
          padding: "10px 16px",
          borderRadius: 9,
          border: "none",
          backgroundImage: active
            ? accent.gradient
            : `linear-gradient(135deg, ${accent.glow} 0%, transparent 100%)`,
          backgroundColor: active ? "transparent" : "var(--color-surface-raised)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.06em",
          fontFamily: "inherit",
          color: active ? "#fff" : "var(--color-text-secondary)",
          cursor: "pointer",
          transition: "all 0.18s",
          boxShadow: active ? `0 4px 16px ${accent.glow}` : "none",
        }}
      >
        {plan.ctaLabel}
      </button>
    </div>
  );
}

function PriceDisplay({
  prices,
  interval,
}: {
  prices: { monthly: number; yearly: number } | null;
  interval: BillingInterval;
}) {
  if (prices === null) {
    return (
      <span
        style={{
          fontSize: 30,
          fontWeight: 800,
          color: "var(--color-text-primary)",
          lineHeight: 1,
        }}
      >
        Custom
      </span>
    );
  }

  const monthly = prices.monthly;
  const yearlyPerMonth = prices.yearly;
  const isFree = monthly === 0;

  if (isFree) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          style={{
            fontSize: 30,
            fontWeight: 800,
            color: "var(--color-text-primary)",
            lineHeight: 1,
          }}
        >
          $0
        </span>
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>/mo</span>
      </div>
    );
  }

  if (interval === "yearly") {
    const annualTotal = yearlyPerMonth * 12;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 30,
              fontWeight: 800,
              color: "var(--color-text-primary)",
              lineHeight: 1,
            }}
          >
            ${yearlyPerMonth}
          </span>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>/mo</span>
          <span
            aria-label={`originally $${monthly} per month`}
            style={{
              fontSize: 13,
              color: "var(--color-text-muted)",
              textDecoration: "line-through",
              opacity: 0.7,
            }}
          >
            ${monthly}
          </span>
        </div>
        <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0 }}>
          ${annualTotal} billed yearly
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
      <span
        style={{
          fontSize: 30,
          fontWeight: 800,
          color: "var(--color-text-primary)",
          lineHeight: 1,
        }}
      >
        ${monthly}
      </span>
      <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>/mo</span>
    </div>
  );
}
