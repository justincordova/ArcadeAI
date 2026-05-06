export type Tier = "free" | "creator" | "pro" | "admin";

// Canonical export. Shape accommodates step 7 (allotments + enforcement flag)
// and step 8 (display values for pricing). Per SPEC §10: only Free has an
// enforced daily cap; paid tiers' daily counter is decremented for
// observability but the daily check is skipped.
export const TIER_CREDIT_LIMITS: Record<
  Tier,
  {
    monthly: number;
    daily: number;
    dailyEnforced: boolean;
  }
> = {
  free: { monthly: 3000, daily: 500, dailyEnforced: true },
  creator: { monthly: 20000, daily: 20000, dailyEnforced: false },
  pro: { monthly: 50000, daily: 50000, dailyEnforced: false },
  admin: {
    monthly: Number.MAX_SAFE_INTEGER,
    daily: Number.MAX_SAFE_INTEGER,
    dailyEnforced: false,
  },
} as const;
