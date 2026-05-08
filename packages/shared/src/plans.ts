export type Tier = "free" | "creator" | "pro" | "admin";

// Canonical export. Shape accommodates step 7 (allotments + enforcement flag)
// and step 8 (display values for pricing). Per SPEC §10: only Free has an
// enforced daily cap; paid tiers' daily counter is decremented for
// observability but the daily check is skipped.
//
// Tier-change rules (enforced in apps/server/src/routes/billing.ts):
//  - UPGRADE (new monthly cap > current balance): credits jump immediately
//    to the new tier's allotment. Users who pay should see what they paid for.
//  - DOWNGRADE (new monthly cap < current balance): the existing balance is
//    preserved until the next monthly reset boundary. Capping would
//    confiscate already-granted credit.
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

// Per-action credit costs (SPEC §10)
export const CREDIT_COSTS = {
  generation: 200,
  refinement: 150,
  repair: 0,
} as const;

// ── Temporary deployment-phase free-tier policy ───────────────────────────────
// During the initial public deployment, free users are throttled to a hard
// lifetime cap to gate runaway costs while we observe real usage. Once we have
// data, flip ENFORCE_LIFETIME_LIMITS_FOR_FREE to false and the standard SPEC §10
// limits (3000/mo, 500/day) apply again. The lifetime_*_used columns stay in
// the DB regardless for observability.
export const FREE_TIER_LIFETIME_LIMITS = {
  generations: 1,
  refinements: 3,
} as const;

export const ENFORCE_LIFETIME_LIMITS_FOR_FREE = true;

// ── Plan display types (step 08) ──────────────────────────────────────────────

// The four tiers visible on the pricing page (enterprise is display-only)
export type PublicTier = "free" | "creator" | "pro";
export type DisplayTier = PublicTier | "enterprise";
export type BillingInterval = "monthly" | "yearly";

export const YEARLY_DISCOUNT = 0.15;

// Prices in USD. Yearly value is per-month after the discount.
// Enterprise is null — renders "Custom".
export const PLAN_PRICES: Record<DisplayTier, { monthly: number; yearly: number } | null> = {
  free: { monthly: 0, yearly: 0 },
  creator: { monthly: 15, yearly: 13 }, // $156 billed yearly
  pro: { monthly: 29, yearly: 25 }, // $300 billed yearly
  enterprise: null,
} as const;

export interface PlanCopy {
  id: DisplayTier;
  name: string;
  // Tailwind utility classes for the plan's neon-accent treatment.
  // Split into border + text so consumers can apply each independently
  // (border for card outline + CTA outline, text for headings + accents).
  accentBorder: string;
  accentText: string;
  features: string[];
  ctaLabel: string;
}

// Plan display copy. Numeric credit values are NOT duplicated here —
// components read from TIER_CREDIT_LIMITS[plan.id] for credit counts
// and PLAN_PRICES[plan.id] for pricing.
export const PLANS: PlanCopy[] = [
  {
    id: "free",
    name: "Free",
    accentBorder: "border-green-500",
    accentText: "text-green-400",
    features: [
      "3,000 credits / month",
      "500 credits / day cap",
      "Unlimited game saves",
      "Canvas game generation",
    ],
    ctaLabel: "CHOOSE PLAN",
  },
  {
    id: "creator",
    name: "Creator",
    accentBorder: "border-orange-400",
    accentText: "text-orange-400",
    features: [
      "20,000 credits / month",
      "No daily cap",
      "Unlimited game saves",
      "Priority generation",
    ],
    ctaLabel: "CHOOSE PLAN",
  },
  {
    id: "pro",
    name: "Pro",
    accentBorder: "border-yellow-400",
    accentText: "text-yellow-400",
    features: [
      "50,000 credits / month",
      "No daily cap",
      "Unlimited game saves",
      "Priority generation",
      "Early access to new features",
    ],
    ctaLabel: "CHOOSE PLAN",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    accentBorder: "border-purple-500",
    accentText: "text-purple-400",
    features: [
      "Custom credit volume",
      "Dedicated support",
      "SLA guarantees",
      "Custom integrations",
    ],
    ctaLabel: "CONTACT SALES",
  },
];
