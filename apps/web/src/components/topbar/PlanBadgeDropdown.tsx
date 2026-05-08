// The dropdown panel that opens beneath the plan badge. Renders one of
// three credit-usage views depending on tier and the lifetime-limit flag:
// - admin → "unlimited credits"
// - free + ENFORCE_LIFETIME_LIMITS_FOR_FREE → lifetime counters
// - everyone else → daily + monthly bars

import type { MeResponse } from "@arcadeai/shared";
import { ENFORCE_LIFETIME_LIMITS_FOR_FREE, FREE_TIER_LIFETIME_LIMITS } from "@arcadeai/shared";
import { Link } from "@tanstack/react-router";
import type React from "react";

interface TierStyle {
  label: string;
  gradient: string;
  border: string;
}

interface PlanBadgeDropdownProps {
  me: MeResponse | null | undefined;
  tier: "free" | "creator" | "pro" | "admin";
  style: TierStyle;
  dailyTotal: number;
  monthlyTotal: number;
  onClose: () => void;
}

export function PlanBadgeDropdown({
  me,
  tier,
  style,
  dailyTotal,
  monthlyTotal,
  onClose,
}: PlanBadgeDropdownProps) {
  const isAdmin = tier === "admin";
  const showLifetime = tier === "free" && ENFORCE_LIFETIME_LIMITS_FOR_FREE;

  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: "calc(100% + 8px)",
        width: 280,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.08)",
        overflow: "hidden",
        zIndex: 100,
      }}
    >
      <div
        style={{
          padding: "14px 16px 12px",
          borderBottom: "1px solid var(--color-border)",
          backgroundImage: style.gradient,
          backgroundClip: "border-box",
          background: "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.06em",
              backgroundImage: style.gradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {style.label} PLAN
          </span>
        </div>
      </div>

      <div style={{ padding: "14px 16px" }}>
        {isAdmin ? (
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            Admin access — unlimited credits.
          </p>
        ) : showLifetime ? (
          <LifetimeUsage
            generationsUsed={me?.lifetimeGenerationsUsed ?? 0}
            refinementsUsed={me?.lifetimeRefinementsUsed ?? 0}
          />
        ) : (
          <>
            <UsageBar
              label="Daily credits"
              remaining={me?.creditsRemainingDaily ?? 0}
              total={dailyTotal}
            />
            <UsageBar
              label="Monthly credits"
              remaining={me?.creditsRemainingMonthly ?? 0}
              total={monthlyTotal}
            />
          </>
        )}
      </div>

      <div style={{ padding: "10px 16px 14px", borderTop: "1px solid var(--color-border)" }}>
        <Link
          to="/pricing"
          onClick={onClose}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            background:
              "linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(6,182,212,0.15) 100%)",
            border: "1px solid rgba(124,58,237,0.25)",
            color: "var(--color-accent-violet-light)",
            textDecoration: "none",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
            (e.currentTarget as HTMLAnchorElement).style.background =
              "linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(6,182,212,0.25) 100%)";
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
            (e.currentTarget as HTMLAnchorElement).style.background =
              "linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(6,182,212,0.15) 100%)";
          }}
        >
          View plans &amp; pricing
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <title>Arrow right</title>
            <path
              d="M2.5 6h7M6.5 3l3 3-3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </div>
    </div>
  );
}

function UsageBar({
  label,
  remaining,
  total,
}: {
  label: string;
  remaining: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(remaining / total, 1) : 0;
  const pctDisplay = Math.round(pct * 100);

  let barColor = "var(--color-success)";
  if (pct <= 0.1) barColor = "var(--color-danger)";
  else if (pct <= 0.3) barColor = "var(--color-warning)";

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 5,
          fontSize: 11,
          color: "var(--color-text-secondary)",
        }}
      >
        <span>{label}</span>
        <span style={{ color: "var(--color-text-muted)" }}>
          {remaining.toLocaleString()} / {total.toLocaleString()}
          <span style={{ marginLeft: 4, opacity: 0.7 }}>({pctDisplay}%)</span>
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: "var(--color-border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pctDisplay}%`,
            background: barColor,
            borderRadius: 2,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

function LifetimeUsage({
  generationsUsed,
  refinementsUsed,
}: {
  generationsUsed: number;
  refinementsUsed: number;
}) {
  const genTotal = FREE_TIER_LIFETIME_LIMITS.generations;
  const refTotal = FREE_TIER_LIFETIME_LIMITS.refinements;
  const genLeft = Math.max(0, genTotal - generationsUsed);
  const refLeft = Math.max(0, refTotal - refinementsUsed);
  const genColor = genLeft === 0 ? "var(--color-danger)" : "var(--color-text-primary)";
  const refColor = refLeft === 0 ? "var(--color-danger)" : "var(--color-text-primary)";

  return (
    <div>
      <p
        style={{
          fontSize: 11,
          color: "var(--color-text-muted)",
          marginBottom: 10,
          lineHeight: 1.5,
        }}
      >
        Free trial — limited generations and refinements while we test.
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 12,
          marginBottom: 8,
        }}
      >
        <span style={{ color: "var(--color-text-secondary)" }}>Generations</span>
        <span style={{ color: genColor, fontWeight: 600 }}>
          {generationsUsed} / {genTotal}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 12,
        }}
      >
        <span style={{ color: "var(--color-text-secondary)" }}>Refinements</span>
        <span style={{ color: refColor, fontWeight: 600 }}>
          {refinementsUsed} / {refTotal}
        </span>
      </div>
    </div>
  );
}
