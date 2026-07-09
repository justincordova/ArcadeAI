// Plan badge in the top bar — color-coded pill that opens a credit-usage
// dropdown on click. The dropdown's full implementation lives in
// PlanBadgeDropdown so this file stays focused on the trigger UI and the
// outside-click close behavior.

import { useOutsideClick } from "@/hooks/useOutsideClick.js";
import { useSession } from "@/hooks/useSession.js";
import { TIER_CREDIT_LIMITS, type Tier } from "@arcadeai/shared";
import { useCallback, useRef, useState } from "react";
import { PlanBadgeDropdown } from "./PlanBadgeDropdown.js";

const TIER_STYLES: Record<string, { label: string; gradient: string; border: string }> = {
  free: {
    label: "FREE",
    gradient: "var(--gradient-brand)",
    border: "rgba(6,182,212,0.4)",
  },
  creator: {
    label: "CREATOR",
    gradient: "var(--gradient-brand)",
    border: "rgba(245,158,11,0.4)",
  },
  pro: {
    label: "PRO",
    gradient: "var(--gradient-brand)",
    border: "rgba(167,139,250,0.4)",
  },
  admin: {
    label: "ADMIN",
    gradient: "var(--gradient-brand)",
    border: "rgba(167,139,250,0.5)",
  },
};

const PLACEHOLDER_CLASS = "w-16 h-6 rounded-full animate-pulse";

function isKnownTier(t: string): t is Tier {
  return t === "free" || t === "creator" || t === "pro" || t === "admin";
}

export function PlanBadge() {
  const { data: me, isLoading } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useOutsideClick(
    ref,
    open,
    useCallback(() => setOpen(false), [])
  );

  if (isLoading) {
    return <div className={PLACEHOLDER_CLASS} style={{ background: "var(--color-border)" }} />;
  }

  const rawTier = me?.tier ?? "free";
  const tier: Tier = isKnownTier(rawTier) ? rawTier : "free";
  const style = TIER_STYLES[tier] ?? TIER_STYLES.free;
  const limits = TIER_CREDIT_LIMITS[tier];

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
          <title>{open ? "Close menu" : "Open menu"}</title>
          <path
            d={open ? "M2 7L5 4L8 7" : "M2 4L5 7L8 4"}
            stroke="url(#badge-grad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient id="badge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--color-accent-primary)" />
              <stop offset="100%" stopColor="var(--color-accent-secondary)" />
            </linearGradient>
          </defs>
        </svg>
      </button>

      {open && (
        <PlanBadgeDropdown
          me={me}
          tier={tier}
          style={style}
          dailyTotal={limits.daily}
          monthlyTotal={limits.monthly}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
