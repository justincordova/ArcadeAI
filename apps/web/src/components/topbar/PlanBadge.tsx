import { TIER_CREDIT_LIMITS, type Tier } from "@arcadeai/shared";
import { Link } from "@tanstack/react-router";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../hooks/useSession.js";

const TIER_STYLES: Record<string, { label: string; gradient: string; border: string }> = {
  free: {
    label: "FREE",
    gradient: "linear-gradient(135deg, #22d3a0 0%, #06b6d4 100%)",
    border: "rgba(6,182,212,0.4)",
  },
  creator: {
    label: "CREATOR",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
    border: "rgba(245,158,11,0.4)",
  },
  pro: {
    label: "PRO",
    gradient: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)",
    border: "rgba(167,139,250,0.4)",
  },
  admin: {
    label: "ADMIN",
    gradient: "linear-gradient(135deg, #a78bfa 0%, #06b6d4 100%)",
    border: "rgba(167,139,250,0.5)",
  },
};

const PLACEHOLDER_CLASS = "w-16 h-6 rounded-full animate-pulse";

function isKnownTier(t: string): t is Tier {
  return t === "free" || t === "creator" || t === "pro" || t === "admin";
}

interface UsageBarProps {
  label: string;
  remaining: number;
  total: number;
}

function UsageBar({ label, remaining, total }: UsageBarProps) {
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

export function PlanBadge() {
  const { data: me, isLoading } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (isLoading) {
    return <div className={PLACEHOLDER_CLASS} style={{ background: "var(--color-border)" }} />;
  }

  const rawTier = me?.tier ?? "free";
  const tier: Tier = isKnownTier(rawTier) ? rawTier : "free";
  const isAdmin = tier === "admin";
  const style = TIER_STYLES[tier] ?? TIER_STYLES.free;
  const limits = TIER_CREDIT_LIMITS[tier];
  const dailyTotal = limits.daily;
  const monthlyTotal = limits.monthly;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 10px",
          borderRadius: 9999,
          fontFamily: "inherit",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          cursor: "pointer",
          border: `1px solid ${style.border}`,
          background: "transparent",
          color: "transparent",
          backgroundImage: style.gradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          transition: "opacity 0.15s",
          position: "relative",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.8";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "1";
        }}
      >
        {style.label}
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        >
          <path
            d={open ? "M2 7L5 4L8 7" : "M2 4L5 7L8 4"}
            stroke="url(#badge-grad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient id="badge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
        </svg>
      </button>

      {open && (
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
          {/* Header */}
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

          {/* Usage */}
          <div style={{ padding: "14px 16px" }}>
            {isAdmin ? (
              <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                Admin access — unlimited credits.
              </p>
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

          {/* Footer */}
          <div
            style={{
              padding: "10px 16px 14px",
              borderTop: "1px solid var(--color-border)",
            }}
          >
            <Link
              to="/pricing"
              onClick={() => setOpen(false)}
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
              View plans & pricing
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
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
      )}
    </div>
  );
}
