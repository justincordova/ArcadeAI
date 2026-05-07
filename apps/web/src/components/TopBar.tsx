import { TIER_CREDIT_LIMITS, type Tier } from "@arcadeai/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useSession } from "../hooks/useSession.js";
import { signOut } from "../lib/auth.js";
import { PlanBadge } from "./topbar/PlanBadge.js";

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

  let barColor = "bg-green-500";
  if (pct <= 0.1) barColor = "bg-red-500";
  else if (pct <= 0.3) barColor = "bg-yellow-500";

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span>
          {remaining.toLocaleString()} / {total.toLocaleString()} ({pctDisplay}%)
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pctDisplay}%` }}
        />
      </div>
    </div>
  );
}

export function TopBar() {
  const { data: me } = useSession();
  const [open, setOpen] = useState(false);

  const rawTier = me?.tier ?? "free";
  const tier: Tier = isKnownTier(rawTier) ? rawTier : "free";
  const isAdmin = tier === "admin";
  const limits = TIER_CREDIT_LIMITS[tier];
  const dailyTotal = limits.daily;
  const monthlyTotal = limits.monthly;

  return (
    <header className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-3">
      <div className="flex items-center gap-3">
        <Link to="/" className="font-mono text-lg font-bold tracking-tight text-white">
          ArcadeAI
        </Link>
        <PlanBadge />
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-700 text-xs font-medium text-white">
            {me?.displayName?.[0]?.toUpperCase() ?? "?"}
          </span>
          <span className="hidden sm:block">{me?.displayName ?? "..."}</span>
          <span className="text-xs">▾</span>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
            <div className="border-b border-gray-700 px-4 py-3">
              <p className="font-mono text-sm font-medium text-white">{me?.displayName}</p>
              <p className="truncate text-xs text-gray-400">{me?.email}</p>
              <p className="mt-0.5 text-xs capitalize text-gray-500">{tier} plan</p>
            </div>

            {/* Usage bars */}
            <div className="border-b border-gray-700 px-4 py-3">
              {isAdmin ? (
                <p className="text-xs text-gray-400">Admin — unlimited</p>
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

            <Link
              to="/pricing"
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              onClick={() => setOpen(false)}
            >
              ⬆ Upgrade plan
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              ⏻ Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
