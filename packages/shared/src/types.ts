import type { Tier } from "./plans.js";

export type { Tier };

export type LinkedProvider = "google" | "github";

export type Theme = "dark" | "light" | "system";

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  tier: Tier;
  theme: Theme;
  creditsRemainingDaily: number;
  creditsRemainingMonthly: number;
  dailyResetAt: number;
  monthlyResetAt: number;
  // Lifetime counters used by the temporary deployment-phase free-tier policy.
  // Always returned; the client decides how to render based on the active
  // policy (see ENFORCE_LIFETIME_LIMITS_FOR_FREE in plans.ts).
  lifetimeGenerationsUsed: number;
  lifetimeRefinementsUsed: number;
  linkedProviders: LinkedProvider[];
}
