import { users } from "@arcadeai/db";
import { TIER_CREDIT_LIMITS, type Tier } from "@arcadeai/shared";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";

// Pure time helpers — unit-testable
export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

export function nextUtcMonthStart(now: number): number {
  const d = new Date(now);
  // First of next month at 00:00:00 UTC
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export async function applyResets(userId: string) {
  const now = Date.now();

  const rows = await db
    .select({
      tier: users.tier,
      creditsRemainingDaily: users.creditsRemainingDaily,
      creditsRemainingMonthly: users.creditsRemainingMonthly,
      dailyResetAt: users.dailyResetAt,
      monthlyResetAt: users.monthlyResetAt,
      lifetimeGenerationsUsed: users.lifetimeGenerationsUsed,
      lifetimeRefinementsUsed: users.lifetimeRefinementsUsed,
    })
    .from(users)
    .where(eq(users.id, userId));

  const user = rows[0];
  if (!user) return null;

  const tier = user.tier as Tier;
  const limits = TIER_CREDIT_LIMITS[tier];

  let dailyResetAt = user.dailyResetAt;
  let monthlyResetAt = user.monthlyResetAt;
  let creditsRemainingDaily = user.creditsRemainingDaily;
  let creditsRemainingMonthly = user.creditsRemainingMonthly;
  let changed = false;

  if (now >= dailyResetAt) {
    // Admin: don't reset counters but still advance timestamp
    if (tier !== "admin") {
      creditsRemainingDaily = limits.daily;
    }
    dailyResetAt = nextUtcMidnight(now);
    changed = true;
  }

  if (now >= monthlyResetAt) {
    if (tier !== "admin") {
      creditsRemainingMonthly = limits.monthly;
      creditsRemainingDaily = limits.daily; // also reset daily on monthly reset
    }
    monthlyResetAt = nextUtcMonthStart(now);
    dailyResetAt = nextUtcMidnight(now); // sync daily too
    changed = true;
  }

  if (changed) {
    await db
      .update(users)
      .set({ creditsRemainingDaily, creditsRemainingMonthly, dailyResetAt, monthlyResetAt })
      .where(eq(users.id, userId));
  }

  return {
    tier,
    creditsRemainingDaily: changed ? creditsRemainingDaily : user.creditsRemainingDaily,
    creditsRemainingMonthly: changed ? creditsRemainingMonthly : user.creditsRemainingMonthly,
    dailyResetAt,
    monthlyResetAt,
    lifetimeGenerationsUsed: user.lifetimeGenerationsUsed,
    lifetimeRefinementsUsed: user.lifetimeRefinementsUsed,
  };
}
