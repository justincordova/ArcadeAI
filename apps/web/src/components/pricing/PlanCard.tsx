import {
  type BillingInterval,
  PLAN_PRICES,
  type PlanCopy,
  TIER_CREDIT_LIMITS,
} from "@arcadeai/shared";
import { useState } from "react";

interface PlanCardProps {
  plan: PlanCopy;
  interval: BillingInterval;
  isActive: boolean;
}

// Accent colors per plan
const PLAN_ACCENTS: Record<string, { gradient: string; border: string; glow: string }> = {
  free: {
    gradient: "linear-gradient(135deg, #22d3a0 0%, #06b6d4 100%)",
    border: "rgba(34,211,160,0.3)",
    glow: "rgba(34,211,160,0.08)",
  },
  creator: {
    gradient: "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
    border: "rgba(245,158,11,0.3)",
    glow: "rgba(245,158,11,0.08)",
  },
  pro: {
    gradient: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)",
    border: "rgba(167,139,250,0.35)",
    glow: "rgba(167,139,250,0.08)",
  },
  enterprise: {
    gradient: "linear-gradient(135deg, #a78bfa 0%, #06b6d4 100%)",
    border: "rgba(167,139,250,0.3)",
    glow: "rgba(167,139,250,0.06)",
  },
};

export function PlanCard({ plan, interval, isActive }: PlanCardProps) {
  const [hovered, setHovered] = useState(false);
  const prices = PLAN_PRICES[plan.id];
  const credits = plan.id === "enterprise" ? null : TIER_CREDIT_LIMITS[plan.id];

  const priceDisplay =
    prices === null ? "Custom" : prices[interval] === 0 ? "$0" : `$${prices[interval]}`;

  const yearlySubLabel =
    interval === "yearly" && prices !== null && prices.yearly > 0
      ? `$${prices.yearly * 12} billed yearly`
      : null;

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
        borderRadius: 16,
        border: `1px solid ${active ? accent.border : "var(--color-border)"}`,
        background: active
          ? `linear-gradient(160deg, ${accent.glow} 0%, var(--color-surface) 60%)`
          : "var(--color-surface)",
        padding: "24px 20px",
        transition: "all 0.2s",
        boxShadow: active
          ? `0 0 32px ${accent.glow}, 0 8px 32px rgba(0,0,0,0.3)`
          : "0 4px 16px rgba(0,0,0,0.2)",
      }}
    >
      {/* Gradient top edge */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          borderRadius: "16px 16px 0 0",
          background: accent.gradient,
          opacity: active ? 1 : 0.4,
          transition: "opacity 0.2s",
        }}
      />

      {/* Active pill */}
      {isActive && (
        <div style={{ position: "absolute", right: 16, top: 14 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              padding: "3px 8px",
              borderRadius: 9999,
              border: `1px solid ${accent.border}`,
              backgroundImage: accent.gradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            ACTIVE
          </span>
        </div>
      )}

      {/* Plan name */}
      <h3
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.04em",
          marginBottom: 16,
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
        <span
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: "var(--color-text-primary)",
            lineHeight: 1,
          }}
        >
          {priceDisplay}
        </span>
        {prices !== null && prices[interval] > 0 && (
          <span
            style={{
              fontSize: 13,
              color: "var(--color-text-muted)",
              marginLeft: 4,
            }}
          >
            /mo
          </span>
        )}
      </div>

      {yearlySubLabel && (
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            marginBottom: 4,
          }}
        >
          {yearlySubLabel}
        </p>
      )}

      {credits && (
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-secondary)",
            marginBottom: 20,
          }}
        >
          {credits.monthly.toLocaleString()} credits / month
        </p>
      )}

      {!credits && <div style={{ marginBottom: 20 }} />}

      {/* Feature list */}
      <ul
        style={{
          flex: 1,
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
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
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <path
                d="M2.5 7.5l3 2.5 6-6"
                stroke="url(#check-grad)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient id="check-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
            </svg>
            {f}
          </li>
        ))}
      </ul>

      {/* CTA button — no-op per SPEC §12 */}
      <button
        type="button"
        onClick={() => {}}
        style={{
          marginTop: 24,
          width: "100%",
          padding: "10px 16px",
          borderRadius: 9,
          border: `1px solid ${accent.border}`,
          background: active
            ? `linear-gradient(135deg, ${accent.glow.replace("0.08", "0.15")} 0%, transparent 100%)`
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
        }}
      >
        {plan.ctaLabel}
      </button>
    </div>
  );
}
