// SPEC §10: credit deduction, refund idempotency, admin bypass.
// Only Free has an enforced daily cap; Creator/Pro skip the daily check.

import { randomUUID } from "node:crypto";
import { usageLog, users } from "@arcadeai/db";
import { CREDIT_COSTS, TIER_CREDIT_LIMITS, type Tier } from "@arcadeai/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { applyResets } from "./reset.js";

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

  // For Free: enforce both daily and monthly
  // For Creator/Pro: enforce only monthly; daily decremented for observability
  if (limits.dailyEnforced && user.creditsRemainingDaily < cost) {
    throw new InsufficientCreditsError("Daily credit limit reached", user.dailyResetAt);
  }
  if (user.creditsRemainingMonthly < cost) {
    throw new InsufficientCreditsError("Monthly credit limit reached", user.monthlyResetAt);
  }

  // Decrement counters
  await db
    .update(users)
    .set({
      creditsRemainingDaily: sql`${users.creditsRemainingDaily} - ${cost}`,
      creditsRemainingMonthly: sql`${users.creditsRemainingMonthly} - ${cost}`,
    })
    .where(eq(users.id, userId));

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

export async function refund(logId: string): Promise<void> {
  // Idempotency guard: only refund if refunded_at IS NULL (SPEC §10)
  const rows = await db
    .select({
      userId: usageLog.userId,
      creditsCharged: usageLog.creditsCharged,
      refundedAt: usageLog.refundedAt,
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
}
