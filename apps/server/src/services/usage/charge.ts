// SPEC §10: credit deduction, refund idempotency, admin bypass.
// Only Free has an enforced daily cap; Creator/Pro skip the daily check.

import { randomUUID } from "node:crypto";
import { usageLog, users } from "@arcadeai/db";
import { CREDIT_COSTS, TIER_CREDIT_LIMITS, type Tier } from "@arcadeai/shared";
import { eq, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db, sqlite } from "../../lib/db.js";
import { applyResets } from "./reset.js";

export type RefundReason = "llm_error" | "timeout" | "validation_error" | "abort";

export class InsufficientCreditsError extends Error {
  resetAt: number;
  constructor(message: string, resetAt: number) {
    super(message);
    this.name = "InsufficientCreditsError";
    this.resetAt = resetAt;
  }
}

type Action = "generation" | "refinement" | "repair";

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
    // Admin: no credit check, insert zero-cost log row
    const logId = randomUUID();
    await db.insert(usageLog).values({
      id: logId,
      userId,
      gameId,
      action,
      creditsCharged: 0,
      succeeded: 0,
      refundedAt: null,
      createdAt: Date.now(),
    });
    return { logId };
  }

  // Atomically decrement counters only when the balance is sufficient.
  // A plain read→check→write is a TOCTOU race: two concurrent requests from
  // the same user can both pass the upfront credit check and both deduct.
  // Instead, issue a single conditional UPDATE using the raw sqlite handle so
  // we can inspect `changes` on the Statement result. SQLite serializes
  // writes, so if `changes === 0` the WHERE guard failed — balance was too low.
  let changedRows: number;
  if (limits.dailyEnforced) {
    const stmt = sqlite.prepare(
      `UPDATE "user" SET credits_remaining_daily = credits_remaining_daily - ?, credits_remaining_monthly = credits_remaining_monthly - ? WHERE id = ? AND credits_remaining_daily >= ? AND credits_remaining_monthly >= ?`
    );
    const result = stmt.run(cost, cost, userId, cost, cost);
    changedRows = result.changes;
  } else {
    const stmt = sqlite.prepare(
      `UPDATE "user" SET credits_remaining_daily = credits_remaining_daily - ?, credits_remaining_monthly = credits_remaining_monthly - ? WHERE id = ? AND credits_remaining_monthly >= ?`
    );
    const result = stmt.run(cost, cost, userId, cost);
    changedRows = result.changes;
  }

  if (changedRows === 0) {
    // Re-read user to determine which limit was hit for the correct resetAt.
    if (limits.dailyEnforced && user.creditsRemainingDaily < cost) {
      throw new InsufficientCreditsError("Daily credit limit reached", user.dailyResetAt);
    }
    throw new InsufficientCreditsError("Monthly credit limit reached", user.monthlyResetAt);
  }

  const logId = randomUUID();
  await db.insert(usageLog).values({
    id: logId,
    userId,
    gameId,
    action,
    creditsCharged: cost,
    succeeded: 0,
    refundedAt: null,
    createdAt: Date.now(),
  });

  return { logId };
}

export async function markSucceeded(logId: string): Promise<void> {
  await db.update(usageLog).set({ succeeded: 1 }).where(eq(usageLog.id, logId));
}

export async function refund(
  logId: string,
  opts?: { logger?: FastifyBaseLogger; reason?: RefundReason }
): Promise<void> {
  // Idempotency guard: only refund if refunded_at IS NULL (SPEC §10)
  const rows = await db
    .select({
      userId: usageLog.userId,
      creditsCharged: usageLog.creditsCharged,
      refundedAt: usageLog.refundedAt,
      action: usageLog.action,
    })
    .from(usageLog)
    .where(eq(usageLog.id, logId));

  const row = rows[0];
  if (!row || row.refundedAt !== null) return; // already refunded or not found

  const cost = row.creditsCharged;
  if (cost > 0) {
    await db
      .update(users)
      .set({
        creditsRemainingDaily: sql`${users.creditsRemainingDaily} + ${cost}`,
        creditsRemainingMonthly: sql`${users.creditsRemainingMonthly} + ${cost}`,
      })
      .where(eq(users.id, row.userId));
  }

  await db.update(usageLog).set({ refundedAt: Date.now() }).where(eq(usageLog.id, logId));

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
