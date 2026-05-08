// Pricing-page plan row. Horizontal layout: plan identity + price on the
// left, feature list in the middle, CTA on the right. The card uses a
// vertical accent bar on the left edge instead of a top stripe so the
// horizontal silhouette reads as one piece.
//
// Yearly pricing: the price column shows the discounted per-month price
// alongside a strikethrough of the regular monthly price, then a small
// "billed yearly" footnote with the annual total.

import {
  type BillingInterval,
  PLAN_PRICES,
  type PlanCopy,
  TIER_CREDIT_LIMITS,
} from "@arcadeai/shared";
import { Check } from "lucide-react";
import { useState } from "react";

interface PlanCardProps {
  plan: PlanCopy;
  interval: BillingInterval;
  isActive: boolean;
}

const PLAN_ACCENTS: Record<string, { gradient: string; border: string; glow: string }> = {
  free: {
    gradient: "linear-gradient(180deg, #22d3a0 0%, #06b6d4 100%)",
    border: "rgba(34,211,160,0.3)",
    glow: "rgba(34,211,160,0.08)",
  },
  creator: {
    gradient: "linear-gradient(180deg, #f59e0b 0%, #f97316 100%)",
    border: "rgba(245,158,11,0.3)",
    glow: "rgba(245,158,11,0.08)",
  },
  pro: {
    gradient: "linear-gradient(180deg, #a78bfa 0%, #7c3aed 100%)",
    border: "rgba(167,139,250,0.35)",
    glow: "rgba(167,139,250,0.08)",
  },
  enterprise: {
    gradient: "linear-gradient(180deg, #a78bfa 0%, #06b6d4 100%)",
    border: "rgba(167,139,250,0.3)",
    glow: "rgba(167,139,250,0.06)",
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
        flexDirection: "row",
        alignItems: "stretch",
        borderRadius: 14,
        border: `1px solid ${active ? accent.border : "var(--color-border)"}`,
        background: active
          ? `linear-gradient(90deg, ${accent.glow} 0%, var(--color-surface) 40%)`
          : "var(--color-surface)",
        overflow: "hidden",
        transition: "all 0.2s",
        boxShadow: active
          ? `0 0 24px ${accent.glow}, 0 6px 20px rgba(0,0,0,0.25)`
          : "0 2px 12px rgba(0,0,0,0.18)",
      }}
    >
      {/* Vertical accent bar on the left edge — replaces the old top stripe.
          A solid 3px line full-height reads as a single visual hook for the
          card and works in the horizontal silhouette. */}
      <div
        aria-hidden="true"
        style={{
          width: 3,
          background: accent.gradient,
          opacity: active ? 1 : 0.45,
          transition: "opacity 0.2s",
          flexShrink: 0,
        }}
      />

      {/* ── Identity + price column ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "20px 24px",
          minWidth: 220,
          maxWidth: 240,
          borderRight: "1px solid var(--color-border-subtle)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.04em",
              backgroundImage: accent.gradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              margin: 0,
            }}
          >
            {plan.name.toUpperCase()}
          </h3>
          {isActive && (
            <span
              style={{
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
        </div>

        <PriceDisplay plan={plan} interval={interval} prices={prices} />

        {credits && (
          <p
            style={{
              fontSize: 11,
              color: "var(--color-text-secondary)",
              marginTop: 8,
            }}
          >
            {credits.monthly.toLocaleString()} credits / month
          </p>
        )}
      </div>

      {/* ── Features column ── */}
      <ul
        style={{
          flex: 1,
          listStyle: "none",
          padding: "20px 24px",
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "8px 16px",
          alignContent: "center",
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

      {/* ── CTA column ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "20px 24px",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => {}}
          style={{
            padding: "10px 18px",
            borderRadius: 9,
            border: `1px solid ${accent.border}`,
            background: active
              ? `linear-gradient(135deg, ${accent.glow.replace("0.08", "0.18")} 0%, transparent 100%)`
              : "transparent",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.06em",
            fontFamily: "inherit",
            cursor: "pointer",
            backgroundImage: accent.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            transition: "all 0.15s",
            whiteSpace: "nowrap",
          }}
        >
          {plan.ctaLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Price display column. On yearly:
 *  - Big number = discounted per-month price
 *  - Strikethrough above = regular monthly price
 *  - Footnote below = annual total (e.g. "$156 billed yearly")
 * On monthly: just the number + /mo.
 * On enterprise: "Custom".
 */
function PriceDisplay({
  plan,
  interval,
  prices,
}: {
  plan: PlanCopy;
  interval: BillingInterval;
  prices: { monthly: number; yearly: number } | null;
}) {
  if (prices === null) {
    return (
      <span
        style={{
          fontSize: 28,
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
            fontSize: 28,
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
        {/* Discounted price + strikethrough monthly */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 28,
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

  // Monthly view
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
      <span
        style={{
          fontSize: 28,
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
