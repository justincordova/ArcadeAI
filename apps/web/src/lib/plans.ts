// Web-local plan config — mirrors packages/shared/src/plans.ts
// Inlined to avoid TypeScript project-reference issues with @arcadeai/shared.
// Keep in sync with the canonical source.

export type BillingInterval = "monthly" | "yearly";
export type DisplayTier = "free" | "creator" | "pro" | "enterprise";

export const YEARLY_DISCOUNT = 0.15;

export const PLAN_PRICES: Record<DisplayTier, { monthly: number; yearly: number } | null> = {
  free: { monthly: 0, yearly: 0 },
  creator: { monthly: 15, yearly: 13 },
  pro: { monthly: 29, yearly: 25 },
  enterprise: null,
};

// Credit allotments mirrored from TIER_CREDIT_LIMITS
export const TIER_CREDITS: Record<string, { monthly: number; daily: number } | null> = {
  free: { monthly: 3000, daily: 500 },
  creator: { monthly: 20000, daily: 20000 },
  pro: { monthly: 50000, daily: 50000 },
  enterprise: null,
};

export interface PlanCopy {
  id: DisplayTier;
  name: string;
  accentBorder: string;
  accentText: string;
  features: string[];
  ctaLabel: string;
}

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
