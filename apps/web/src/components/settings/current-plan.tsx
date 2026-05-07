import type { MeResponse } from "@arcadeai/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type React from "react";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  creator: "Creator",
  pro: "Pro",
  admin: "Admin",
};

export function CurrentPlan() {
  const { data: me } = useQuery<MeResponse | null>({ queryKey: ["me"] });
  const tier = me?.tier ?? "free";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-text-secondary)",
            marginBottom: 4,
          }}
        >
          Current plan
        </p>
        <p style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
          {PLAN_LABELS[tier] ?? tier}
        </p>
      </div>
      <Link
        to="/pricing"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 14px",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "inherit",
          background:
            "linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(6,182,212,0.12) 100%)",
          border: "1px solid rgba(124,58,237,0.2)",
          color: "var(--color-accent-violet-light)",
          textDecoration: "none",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(124,58,237,0.4)";
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(124,58,237,0.2)";
        }}
      >
        Manage plan
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
  );
}
