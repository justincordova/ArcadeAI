// SPEC §10: credit deduction, refund idempotency, admin bypass.
// Only Free has an enforced daily cap; Creator/Pro skip the daily check.
//
// Deployment-phase addition: when ENFORCE_LIFETIME_LIMITS_FOR_FREE is on, the
// free tier is gated by FREE_TIER_LIFETIME_LIMITS — a hard cap on
// generations and refinements per account, ever. The lifetime counters live
// on the user row; their guard is folded into the same atomic UPDATE that
// decrements credits, so a race between two concurrent free-tier requests
// can't bypass the cap.

import { randomUUID } from "node:crypto";
import { usageLog, users } from "@arcadeai/db";
import {
  CREDIT_COSTS,
  ENFORCE_LIFETIME_LIMITS_FOR_FREE,
  FREE_TIER_LIFETIME_LIMITS,
  TIER_CREDIT_LIMITS,
  type Tier,
} from "@arcadeai/shared";
import { eq, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db, sqlite } from "../../lib/db.js";
import { applyResets } from "./reset.js";

export type RefundReason =
  | "llm_error"
  | "timeout"
  | "validation_error"
  | "abort"
  | "persistence_error";

export type InsufficientCreditsKind = "daily" | "monthly" | "lifetime";

export class InsufficientCreditsError extends Error {
  resetAt: number;
  kind: InsufficientCreditsKind;
  constructor(message: string, resetAt: number, kind: InsufficientCreditsKind) {
    super(message);
    this.name = "InsufficientCreditsError";
    this.resetAt = resetAt;
    this.kind = kind;
  }
}

type Action = "generation" | "refinement" | "repair";

/**
 * Upfront credit/lifetime check used by streaming routes BEFORE they hijack
 * the response. Returns null if the user can afford the action; otherwise
 * returns a 402-shaped error object the caller can `reply.status(402).send()`.
 *
 * The atomic guard inside `deduct()` is the source of truth — this is purely
 * a UX optimization to surface 402 BEFORE the SSE response opens, so the
 * client can show a friendly upgrade banner instead of an SSE error event.
 */
export function checkUpfront(
  userState: {
    tier: Tier;
    creditsRemainingDaily: number;
    creditsRemainingMonthly: number;
    dailyResetAt: number;
    monthlyResetAt: number;
    lifetimeGenerationsUsed: number;
    lifetimeRefinementsUsed: number;
  },
  action: Action
): { error: "insufficient_credits"; resetAt: number; kind: InsufficientCreditsKind } | null {
  if (userState.tier === "admin") return null;

  const cost = CREDIT_COSTS[action];
  const limits = TIER_CREDIT_LIMITS[userState.tier];

  // Lifetime check first — it's the hardest gate. Free tier only, when the
  // flag is on. Repairs are exempt (action handled below by lifetimeCounterFor).
  if (userState.tier === "free" && ENFORCE_LIFETIME_LIMITS_FOR_FREE) {
    const lifetimeKey = lifetimeCounterFor(action);
    if (
      lifetimeKey === "generations" &&
      userState.lifetimeGenerationsUsed >= FREE_TIER_LIFETIME_LIMITS.generations
    ) {
      return { error: "insufficient_credits", resetAt: 0, kind: "lifetime" };
    }
    if (
      lifetimeKey === "refinements" &&
      userState.lifetimeRefinementsUsed >= FREE_TIER_LIFETIME_LIMITS.refinements
    ) {
      return { error: "insufficient_credits", resetAt: 0, kind: "lifetime" };
    }
  }

  if (limits.dailyEnforced && userState.creditsRemainingDaily < cost) {
    return { error: "insufficient_credits", resetAt: userState.dailyResetAt, kind: "daily" };
  }
  if (userState.creditsRemainingMonthly < cost) {
    return { error: "insufficient_credits", resetAt: userState.monthlyResetAt, kind: "monthly" };
  }
  return null;
}

// Map an action to which lifetime counter (if any) it should increment.
// Repairs don't count against any lifetime cap (they're free + bug-fixing).
function lifetimeCounterFor(action: Action): "generations" | "refinements" | null {
  if (action === "generation") return "generations";
  if (action === "refinement") return "refinements";
  return null;
}

export async function deduct(
  userId: string,
  action: Action,
  gameId: string | null
): Promise<{ logId: string }> {
  // Apply lazy resets first
  const user = await applyResets(userId);
  if (!user) throw new Error("User not found");

  const tier = user.tier as Tier;
  const cost = CREDIT_COSTS[action];
  const limits = TIER_CREDIT_LIMITS[tier];

  if (tier === "admin") {
    // Admin: no credit check, no lifetime check, insert zero-cost log row
    const logId = randomUUID();
    await db.insert(usageLog).values({
      id: logId,
      userId,
      gameId,
      action,
      creditsCharged: 0,
      lifetimeCounterIncremented: false,
      succeeded: 0,
      refundedAt: null,
      createdAt: Date.now(),
    });
    return { logId };
  }

  // Determine whether the lifetime guard applies on this call.
  const lifetimeKey =
    tier === "free" && ENFORCE_LIFETIME_LIMITS_FOR_FREE ? lifetimeCounterFor(action) : null;

  const logId = randomUUID();

  // Build the atomic conditional UPDATE. Folding the lifetime guard into the
  // same WHERE clause means a TOCTOU race between two concurrent requests
  // can't bypass the cap — at most one UPDATE will satisfy the condition.
  //
  // The credit decrement and the usage_log insert run inside ONE bun:sqlite
  // transaction so they commit or roll back together. Without this, an insert
  // failure (disk full, locked DB) would leave the user debited with no
  // refundable log row — credits lost with no audit trail and nothing for
  // refund() to act on.
  const runDeduct = sqlite.transaction((): number => {
    let changed: number;
    if (lifetimeKey === "generations") {
      const limit = FREE_TIER_LIFETIME_LIMITS.generations;
      changed = sqlite
        .prepare(
          `UPDATE "user"
              SET credits_remaining_daily   = credits_remaining_daily   - ?,
                  credits_remaining_monthly = credits_remaining_monthly - ?,
                  lifetime_generations_used = lifetime_generations_used + 1
            WHERE id = ?
              AND credits_remaining_daily   >= ?
              AND credits_remaining_monthly >= ?
              AND lifetime_generations_used < ?`
        )
        .run(cost, cost, userId, cost, cost, limit).changes;
    } else if (lifetimeKey === "refinements") {
      const limit = FREE_TIER_LIFETIME_LIMITS.refinements;
      changed = sqlite
        .prepare(
          `UPDATE "user"
              SET credits_remaining_daily   = credits_remaining_daily   - ?,
                  credits_remaining_monthly = credits_remaining_monthly - ?,
                  lifetime_refinements_used = lifetime_refinements_used + 1
            WHERE id = ?
              AND credits_remaining_daily   >= ?
              AND credits_remaining_monthly >= ?
              AND lifetime_refinements_used < ?`
        )
        .run(cost, cost, userId, cost, cost, limit).changes;
    } else if (limits.dailyEnforced) {
      changed = sqlite
        .prepare(
          `UPDATE "user"
              SET credits_remaining_daily   = credits_remaining_daily   - ?,
                  credits_remaining_monthly = credits_remaining_monthly - ?
            WHERE id = ?
              AND credits_remaining_daily   >= ?
              AND credits_remaining_monthly >= ?`
        )
        .run(cost, cost, userId, cost, cost).changes;
    } else {
      changed = sqlite
        .prepare(
          `UPDATE "user"
              SET credits_remaining_daily   = credits_remaining_daily   - ?,
                  credits_remaining_monthly = credits_remaining_monthly - ?
            WHERE id = ?
              AND credits_remaining_monthly >= ?`
        )
        .run(cost, cost, userId, cost).changes;
    }

    // Guard failed — abort the transaction without inserting a log row. The
    // caller maps this to the appropriate InsufficientCreditsError below.
    if (changed === 0) return 0;

    sqlite
      .prepare(
        `INSERT INTO usage_log
           (id, user_id, game_id, action, credits_charged,
            lifetime_counter_incremented, succeeded, refunded_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`
      )
      .run(logId, userId, gameId, action, cost, lifetimeKey !== null ? 1 : 0, Date.now());

    return changed;
  });

  const changedRows = runDeduct();

  if (changedRows === 0) {
    // The atomic UPDATE failed its guard. Determine which condition triggered
    // it based on the user state we read at the top of this function. The
    // re-read is best-effort; concurrent racers may have shifted state, but
    // the resulting error is still a true rejection.
    if (
      lifetimeKey === "generations" &&
      user.lifetimeGenerationsUsed >= FREE_TIER_LIFETIME_LIMITS.generations
    ) {
      throw new InsufficientCreditsError(
        "Free tier lifetime generation limit reached. Upgrade for more.",
        0,
        "lifetime"
      );
    }
    if (
      lifetimeKey === "refinements" &&
      user.lifetimeRefinementsUsed >= FREE_TIER_LIFETIME_LIMITS.refinements
    ) {
      throw new InsufficientCreditsError(
        "Free tier lifetime refinement limit reached. Upgrade for more.",
        0,
        "lifetime"
      );
    }
    if (limits.dailyEnforced && user.creditsRemainingDaily < cost) {
      throw new InsufficientCreditsError("Daily credit limit reached", user.dailyResetAt, "daily");
    }
    throw new InsufficientCreditsError(
      "Monthly credit limit reached",
      user.monthlyResetAt,
      "monthly"
    );
  }

  return { logId };
}

export async function markSucceeded(logId: string): Promise<void> {
  await db.update(usageLog).set({ succeeded: 1 }).where(eq(usageLog.id, logId));
}

/**
 * Record a remix as a 0-credit "generation" that still counts against the
 * free-tier lifetime cap. Mirrors the atomic-guard shape in `deduct`: free
 * users at the lifetime cap get an InsufficientCreditsError before any DB
 * write happens. Paid users and admins get a no-op log row inserted with
 * the action recorded so the audit trail captures the remix.
 *
 * Returns the logId so the route can refund (which decrements the lifetime
 * counter back) on subsequent failure.
 */
export async function recordRemix(userId: string, gameId: string): Promise<{ logId: string }> {
  const user = await applyResets(userId);
  if (!user) throw new Error("User not found");

  const tier = user.tier as Tier;

  if (tier === "admin") {
    const logId = randomUUID();
    await db.insert(usageLog).values({
      id: logId,
      userId,
      gameId,
      action: "generation",
      creditsCharged: 0,
      lifetimeCounterIncremented: false,
      succeeded: 0,
      refundedAt: null,
      createdAt: Date.now(),
    });
    return { logId };
  }

  const lifetimeGuarded = tier === "free" && ENFORCE_LIFETIME_LIMITS_FOR_FREE;
  const logId = randomUUID();

  // Free + flag on: atomically increment the lifetime generations counter
  // only when below the cap, and insert the log row in the SAME transaction
  // so a counter bump can never be left without a refundable log row (and
  // vice versa). Same TOCTOU guard + atomicity rationale as deduct.
  const runRemix = sqlite.transaction((): boolean => {
    if (lifetimeGuarded) {
      const limit = FREE_TIER_LIFETIME_LIMITS.generations;
      const changedRows = sqlite
        .prepare(
          `UPDATE "user"
              SET lifetime_generations_used = lifetime_generations_used + 1
            WHERE id = ?
              AND lifetime_generations_used < ?`
        )
        .run(userId, limit).changes;
      if (changedRows === 0) return false;
    }

    sqlite
      .prepare(
        `INSERT INTO usage_log
           (id, user_id, game_id, action, credits_charged,
            lifetime_counter_incremented, succeeded, refunded_at, created_at)
         VALUES (?, ?, ?, 'generation', 0, ?, 0, NULL, ?)`
      )
      .run(logId, userId, gameId, lifetimeGuarded ? 1 : 0, Date.now());

    return true;
  });

  if (!runRemix()) {
    throw new InsufficientCreditsError(
      "Free tier lifetime generation limit reached. Upgrade for more.",
      0,
      "lifetime"
    );
  }

  return { logId };
}

export async function refund(
  logId: string,
  opts?: { logger?: FastifyBaseLogger; reason?: RefundReason }
): Promise<void> {
  // Read the row to know how much to refund and whether to decrement the
  // lifetime counter. The read itself is not the idempotency guard — that
  // role belongs to the conditional UPDATE on `refunded_at` below, which
  // atomically claims the refund. A concurrent racing refund() against the
  // same logId will lose the UPDATE race (changes === 0) and skip crediting.
  const rows = await db
    .select({
      userId: usageLog.userId,
      creditsCharged: usageLog.creditsCharged,
      lifetimeCounterIncremented: usageLog.lifetimeCounterIncremented,
      refundedAt: usageLog.refundedAt,
      action: usageLog.action,
    })
    .from(usageLog)
    .where(eq(usageLog.id, logId));

  const row = rows[0];
  if (!row || row.refundedAt !== null) return; // already refunded or not found

  // Atomically claim the refund. Only the call whose UPDATE actually
  // changed a row (i.e. saw refunded_at IS NULL at write time) is allowed
  // to credit the user and decrement the lifetime counter. This closes a
  // TOCTOU between the SELECT above and the UPDATE that previously allowed
  // two concurrent refunds to double-credit the user.
  const claimStmt = sqlite.prepare(
    "UPDATE usage_log SET refunded_at = ? WHERE id = ? AND refunded_at IS NULL"
  );
  const claimed = claimStmt.run(Date.now(), logId).changes;
  if (claimed === 0) return; // lost the race; another refund() already credited.

  const cost = row.creditsCharged;
  const action = row.action as Action;
  // Whether to decrement the lifetime counter is recorded on the log row at
  // deduct time, not re-derived. This is robust against the
  // ENFORCE_LIFETIME_LIMITS_FOR_FREE flag flipping or the user's tier
  // changing between deduct and refund.
  const lifetimeKey = row.lifetimeCounterIncremented ? lifetimeCounterFor(action) : null;

  if (cost > 0 || lifetimeKey !== null) {
    if (lifetimeKey === "generations") {
      await db
        .update(users)
        .set({
          creditsRemainingDaily: sql`${users.creditsRemainingDaily} + ${cost}`,
          creditsRemainingMonthly: sql`${users.creditsRemainingMonthly} + ${cost}`,
          // CASE-guarded so we never go below 0 even if the row was reset
          // between deduct and refund.
          lifetimeGenerationsUsed: sql`CASE WHEN ${users.lifetimeGenerationsUsed} > 0 THEN ${users.lifetimeGenerationsUsed} - 1 ELSE 0 END`,
        })
        .where(eq(users.id, row.userId));
    } else if (lifetimeKey === "refinements") {
      await db
        .update(users)
        .set({
          creditsRemainingDaily: sql`${users.creditsRemainingDaily} + ${cost}`,
          creditsRemainingMonthly: sql`${users.creditsRemainingMonthly} + ${cost}`,
          lifetimeRefinementsUsed: sql`CASE WHEN ${users.lifetimeRefinementsUsed} > 0 THEN ${users.lifetimeRefinementsUsed} - 1 ELSE 0 END`,
        })
        .where(eq(users.id, row.userId));
    } else if (cost > 0) {
      await db
        .update(users)
        .set({
          creditsRemainingDaily: sql`${users.creditsRemainingDaily} + ${cost}`,
          creditsRemainingMonthly: sql`${users.creditsRemainingMonthly} + ${cost}`,
        })
        .where(eq(users.id, row.userId));
    }
  }

  // Observability log line per SPEC §10 / plan 13 §10.
  opts?.logger?.info(
    {
      logId,
      action: row.action,
      amount: cost,
      reason: opts?.reason ?? "llm_error",
    },
    "credits refunded"
  );
}
