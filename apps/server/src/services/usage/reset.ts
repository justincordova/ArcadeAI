import { users } from "@arcadeai/db";
import { TIER_CREDIT_LIMITS, type Tier } from "@arcadeai/shared";
import { and, eq } from "drizzle-orm";
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
  let dailyFired = false;
  let monthlyFired = false;

  if (now >= dailyResetAt) {
    // Admin: don't reset counters but still advance timestamp
    if (tier !== "admin") {
      creditsRemainingDaily = limits.daily;
    }
    dailyResetAt = nextUtcMidnight(now);
    dailyFired = true;
  }

  if (now >= monthlyResetAt) {
    if (tier !== "admin") {
      creditsRemainingMonthly = limits.monthly;
      creditsRemainingDaily = limits.daily; // also reset daily on monthly reset
    }
    monthlyResetAt = nextUtcMonthStart(now);
    dailyResetAt = nextUtcMidnight(now); // sync daily too
    monthlyFired = true;
  }

  const changed = dailyFired || monthlyFired;

  if (changed) {
    // Conditional UPDATE keyed on the timestamp we read. If a concurrent
    // request already advanced the reset window (and decremented credits
    // on the freshly-granted balance), our WHERE clause excludes the row
    // and we leave the row alone — re-reading the canonical state below.
    //
    // Without this guard, a non-atomic read-decide-write would clobber a
    // concurrent deduct from a parallel request that hit the reset window
    // first, silently restoring credits that were just consumed.
    //
    // Write back ONLY the credit columns whose window actually fired. The
    // WHERE guard keys on the two timestamps, so it cannot see a writer that
    // changes credits without touching them — and refund() is exactly that
    // writer. Writing the untouched column back from our stale snapshot would
    // erase a refund that landed in the window between the SELECT above and
    // this UPDATE. That loss is unrecoverable: refund() has already committed
    // `refunded_at`, which is its idempotency guard, so no retry re-credits.
    // The daily column is always written here: reaching this block means at
    // least one window fired, and both branches above set creditsRemainingDaily
    // (a monthly reset also refills daily). Only the monthly column is
    // conditional — that is the one a concurrent refund can touch without
    // moving a timestamp.
    const patch: Partial<typeof users.$inferInsert> = {
      dailyResetAt,
      monthlyResetAt,
      creditsRemainingDaily,
    };
    if (monthlyFired) patch.creditsRemainingMonthly = creditsRemainingMonthly;

    const result = await db
      .update(users)
      .set(patch)
      .where(
        and(
          eq(users.id, userId),
          eq(users.dailyResetAt, user.dailyResetAt),
          eq(users.monthlyResetAt, user.monthlyResetAt)
        )
      );

    // Drizzle's run-result `.changes` reflects rows actually written. If the
    // conditional WHERE missed (someone else already reset), reread the row
    // and return the fresh canonical values instead of our stale plan.
    // Drizzle's update for bun-sqlite returns a RunResult-like object; we
    // detect a miss by re-selecting (cheap on the same indexed pk).
    // biome-ignore lint/suspicious/noExplicitAny: bun-sqlite RunResult shape
    if ((result as any)?.changes === 0) {
      const fresh = await db
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
      const f = fresh[0];
      if (!f) {
        // The conditional UPDATE missed AND the re-select found nothing:
        // the user row was deleted between our initial read and now (e.g.
        // DELETE /api/me racing in another tab). Falling through would
        // fabricate counters for a nonexistent user — callers treat a
        // non-null return as "user exists", so deduct() would then
        // misreport the miss as InsufficientCreditsError instead of
        // user-not-found.
        return null;
      }
      return {
        tier: f.tier as Tier,
        creditsRemainingDaily: f.creditsRemainingDaily,
        creditsRemainingMonthly: f.creditsRemainingMonthly,
        dailyResetAt: f.dailyResetAt,
        monthlyResetAt: f.monthlyResetAt,
        lifetimeGenerationsUsed: f.lifetimeGenerationsUsed,
        lifetimeRefinementsUsed: f.lifetimeRefinementsUsed,
      };
    }
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
