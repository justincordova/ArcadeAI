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
  linkedProviders: LinkedProvider[];
}
