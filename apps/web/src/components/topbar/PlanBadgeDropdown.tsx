// The dropdown panel that opens beneath the plan badge. Renders one of
// three credit-usage views depending on tier and the lifetime-limit flag:
// - admin → "unlimited credits"
// - free + ENFORCE_LIFETIME_LIMITS_FOR_FREE → lifetime counters
// - everyone else → daily + monthly bars

import type { MeResponse } from "@arcadeai/shared";
import { ENFORCE_LIFETIME_LIMITS_FOR_FREE, FREE_TIER_LIFETIME_LIMITS } from "@arcadeai/shared";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

/**
 * Format milliseconds-from-now as a short countdown ("4h 23m", "12m", "47s").
 * Returns null once the deadline has passed so the caller can hide the row.
 */
function formatCountdown(ms: number): string | null {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSec}s`;
}

/** Display "Resets in Xh Ym", refreshing once per minute. */
function ResetCountdown({ resetAt, label }: { resetAt: number; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const text = formatCountdown(resetAt - now);
  if (!text) return null;
  return (
    <div
      style={{
        fontSize: 10,
        color: "var(--color-text-muted)",
        marginTop: -6,
        marginBottom: 8,
      }}
    >
      {label} resets in {text}
    </div>
  );
}

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
        boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,62,165,0.08)",
        overflow: "hidden",
        zIndex: 100,
      }}
    >
      {/* No background tint here: an earlier revision set backgroundImage +
          a `background: "transparent"` shorthand that immediately reset it —
          the gradient never rendered. Keeping the (actual, shipped)
          transparent look and dropping the dead declarations. */}
      <div
        style={{
          padding: "14px 16px 12px",
          borderBottom: "1px solid var(--color-border)",
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
        {!isAdmin && me == null ? (
          // Guard the loading window: without `me`, the usage bars below
          // default to 0 remaining and paint danger-red — making a still-
          // loading state look like "out of credits". Show a neutral
          // placeholder until the profile resolves.
          <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading usage…</p>
        ) : isAdmin ? (
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
              tooltip="Per-day cap on free generations. Refills at midnight UTC; doesn't carry over."
            />
            {me?.dailyResetAt ? <ResetCountdown resetAt={me.dailyResetAt} label="Daily" /> : null}
            <UsageBar
              label="Monthly credits"
              remaining={me?.creditsRemainingMonthly ?? 0}
              total={monthlyTotal}
              tooltip="Total credits per billing month. Includes generations and refinements; resets on the 1st."
            />
            {me?.monthlyResetAt ? (
              <ResetCountdown resetAt={me.monthlyResetAt} label="Monthly" />
            ) : null}
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
              "linear-gradient(135deg, rgba(255,62,165,0.15) 0%, rgba(76,223,232,0.15) 100%)",
            border: "1px solid rgba(255,62,165,0.25)",
            color: "var(--color-accent-primary-soft)",
            textDecoration: "none",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
            (e.currentTarget as HTMLAnchorElement).style.background =
              "linear-gradient(135deg, rgba(255,62,165,0.25) 0%, rgba(76,223,232,0.25) 100%)";
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
            (e.currentTarget as HTMLAnchorElement).style.background =
              "linear-gradient(135deg, rgba(255,62,165,0.15) 0%, rgba(76,223,232,0.15) 100%)";
          }}
        >
          View plans &amp; pricing
          <ArrowRight size={12} strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}

function UsageBar({
  label,
  remaining,
  total,
  tooltip,
}: {
  label: string;
  remaining: number;
  total: number;
  tooltip?: string;
}) {
  const pct = total > 0 ? Math.min(remaining / total, 1) : 0;
  const pctDisplay = Math.round(pct * 100);

  let barColor = "var(--color-success)";
  if (pct <= 0.1) barColor = "var(--color-danger)";
  else if (pct <= 0.3) barColor = "var(--color-warning)";

  return (
    <div style={{ marginBottom: 12 }} title={tooltip}>
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
    <div title={`Free trial: ${genTotal} game + ${refTotal} refinements, lifetime.`}>
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
