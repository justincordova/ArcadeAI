import { fetchMeOrNull } from "@/lib/api/auth.js";
import type { MeResponse } from "@arcadeai/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type React from "react";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  creator: "Creator",
  pro: "Pro",
  admin: "Admin",
};

export function CurrentPlan() {
  const { data: me } = useQuery<MeResponse | null>({
    queryKey: ["me"],
    queryFn: fetchMeOrNull,
  });
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
            "linear-gradient(135deg, rgba(255,62,165,0.12) 0%, rgba(76,223,232,0.12) 100%)",
          border: "1px solid rgba(255,62,165,0.2)",
          color: "var(--color-accent-violet-light)",
          textDecoration: "none",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,62,165,0.4)";
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,62,165,0.2)";
        }}
      >
        Manage plan
        <ArrowRight size={12} strokeWidth={2} />
      </Link>
    </div>
  );
}
