import type { MeResponse } from "@arcadeai/shared";
import {
  CREDIT_COSTS,
  ENFORCE_LIFETIME_LIMITS_FOR_FREE,
  FREE_TIER_LIFETIME_LIMITS,
} from "@arcadeai/shared";
import { describe, expect, test } from "vitest";
import { formatCostLine } from "./cost-line.js";

// Minimal MeResponse factory — only the fields formatCostLine reads matter.
function makeMe(overrides: Partial<MeResponse>): MeResponse {
  return {
    id: "u1",
    email: "a@b.com",
    displayName: "A",
    tier: "creator",
    theme: "dark",
    creditsRemainingDaily: 0,
    creditsRemainingMonthly: 1000,
    dailyResetAt: 0,
    monthlyResetAt: 0,
    lifetimeGenerationsUsed: 0,
    lifetimeRefinementsUsed: 0,
    linkedProviders: [],
    ...overrides,
  };
}

describe("formatCostLine — no line", () => {
  test("returns null when me is undefined", () => {
    expect(formatCostLine(undefined, "Generate", true)).toBeNull();
  });

  test("returns null when me is null", () => {
    expect(formatCostLine(null, "Generate", true)).toBeNull();
  });

  test("returns null for admins (unlimited credits)", () => {
    expect(formatCostLine(makeMe({ tier: "admin" }), "Generate", true)).toBeNull();
  });
});

describe("formatCostLine — paid tiers show credit cost vs balance", () => {
  test("generation cost and thousands-separated balance", () => {
    const me = makeMe({ tier: "creator", creditsRemainingMonthly: 12345 });
    expect(formatCostLine(me, "Generate", true)).toBe(
      `Generate (${CREDIT_COSTS.generation} credits) — you have 12,345`
    );
  });

  test("refinement uses the refinement cost", () => {
    const me = makeMe({ tier: "pro", creditsRemainingMonthly: 500 });
    expect(formatCostLine(me, "Refine", false)).toBe(
      `Refine (${CREDIT_COSTS.refinement} credits) — you have 500`
    );
  });
});

describe("formatCostLine — free tier under lifetime cap", () => {
  // These expectations only hold while the deployment-phase flag is on. If it
  // flips off, free users fall through to the credit-cost branch, so we assert
  // the branch that's actually active.
  test("shows trial counters when the lifetime policy is enforced", () => {
    const me = makeMe({ tier: "free", lifetimeGenerationsUsed: 0, creditsRemainingMonthly: 3000 });
    if (ENFORCE_LIFETIME_LIMITS_FOR_FREE) {
      const total = FREE_TIER_LIFETIME_LIMITS.generations;
      expect(formatCostLine(me, "Generate", true)).toBe(
        `Generate (${total} of ${total} remaining)`
      );
    } else {
      expect(formatCostLine(me, "Generate", true)).toContain("credits");
    }
  });

  test("remaining never goes negative once the cap is exceeded", () => {
    const used = FREE_TIER_LIFETIME_LIMITS.refinements + 5;
    const me = makeMe({ tier: "free", lifetimeRefinementsUsed: used });
    if (ENFORCE_LIFETIME_LIMITS_FOR_FREE) {
      const total = FREE_TIER_LIFETIME_LIMITS.refinements;
      expect(formatCostLine(me, "Refine", false)).toBe(`Refine (0 of ${total} remaining)`);
    } else {
      expect(formatCostLine(me, "Refine", false)).toContain("credits");
    }
  });
});
