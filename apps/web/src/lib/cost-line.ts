// Builds the "cost preview" line shown under the builder's submit button
// (SPEC #44). Pure function so it can be unit-tested without rendering.
//
// Free users under the lifetime cap see trial counters ("3 of 5 remaining");
// everyone else sees credit cost vs. remaining monthly balance. Admins see
// nothing — unlimited credits make the line meaningless.

import type { MeResponse } from "@arcadeai/shared";
import {
  CREDIT_COSTS,
  ENFORCE_LIFETIME_LIMITS_FOR_FREE,
  FREE_TIER_LIFETIME_LIMITS,
} from "@arcadeai/shared";

export function formatCostLine(
  me: MeResponse | null | undefined,
  submitLabel: string,
  isNewGame: boolean
): string | null {
  if (!me || me.tier === "admin") return null;

  if (me.tier === "free" && ENFORCE_LIFETIME_LIMITS_FOR_FREE) {
    const used = isNewGame ? me.lifetimeGenerationsUsed : me.lifetimeRefinementsUsed;
    const total = isNewGame
      ? FREE_TIER_LIFETIME_LIMITS.generations
      : FREE_TIER_LIFETIME_LIMITS.refinements;
    const remaining = Math.max(0, total - used);
    return `${submitLabel} (${remaining} of ${total} remaining)`;
  }

  const cost = CREDIT_COSTS[isNewGame ? "generation" : "refinement"];
  return `${submitLabel} (${cost} credits) — you have ${me.creditsRemainingMonthly.toLocaleString()}`;
}
