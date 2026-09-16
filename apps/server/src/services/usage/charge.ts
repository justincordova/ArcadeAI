import { randomUUID } from "node:crypto";
import { usageLog } from "@arcadeai/db";
import {
  CREDIT_COSTS,
  ENFORCE_LIFETIME_LIMITS_FOR_FREE,
  FREE_TIER_LIFETIME_LIMITS,
  TIER_CREDIT_LIMITS,
  type Tier,
} from "@arcadeai/shared";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db, sql } from "../../lib/db.js";
import { applyResets } from "./reset.js";

export type RefundReason =
  | "llm_error"
  | "timeout"
  | "validation_error"
  | "abort"
  | "persistence_error"
  | "stranded";
export type InsufficientCreditsKind = "daily" | "monthly" | "lifetime";
type Action = "generation" | "refinement" | "repair";

export class InsufficientCreditsError extends Error {
  constructor(
    message: string,
    readonly resetAt: number,
    readonly kind: InsufficientCreditsKind
  ) {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

export function checkUpfront(
  user: {
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
  if (user.tier === "admin") return null;
  const cost = CREDIT_COSTS[action];
  const limits = TIER_CREDIT_LIMITS[user.tier];
  const lifetime =
    user.tier === "free" && ENFORCE_LIFETIME_LIMITS_FOR_FREE ? lifetimeCounterFor(action) : null;
  if (
    lifetime === "generations" &&
    user.lifetimeGenerationsUsed >= FREE_TIER_LIFETIME_LIMITS.generations
  )
    return { error: "insufficient_credits", resetAt: 0, kind: "lifetime" };
  if (
    lifetime === "refinements" &&
    user.lifetimeRefinementsUsed >= FREE_TIER_LIFETIME_LIMITS.refinements
  )
    return { error: "insufficient_credits", resetAt: 0, kind: "lifetime" };
  if (limits.dailyEnforced && user.creditsRemainingDaily < cost)
    return { error: "insufficient_credits", resetAt: user.dailyResetAt, kind: "daily" };
  if (user.creditsRemainingMonthly < cost)
    return { error: "insufficient_credits", resetAt: user.monthlyResetAt, kind: "monthly" };
  return null;
}

function lifetimeCounterFor(action: Action): "generations" | "refinements" | null {
  return action === "generation" ? "generations" : action === "refinement" ? "refinements" : null;
}

export async function deduct(
  userId: string,
  action: Action,
  gameId: string | null
): Promise<{ logId: string }> {
  const user = await applyResets(userId);
  if (!user) throw new Error("User not found");
  const tier = user.tier as Tier;
  const cost = CREDIT_COSTS[action];
  const limits = TIER_CREDIT_LIMITS[tier];
  const logId = randomUUID();
  if (tier === "admin") {
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
  const lifetime =
    tier === "free" && ENFORCE_LIFETIME_LIMITS_FOR_FREE ? lifetimeCounterFor(action) : null;
  const changed = await sql.begin(async (tx) => {
    const rows =
      lifetime === "generations"
        ? await tx<
            { id: string }[]
          >`UPDATE "user" SET credits_remaining_daily = credits_remaining_daily - ${cost}, credits_remaining_monthly = credits_remaining_monthly - ${cost}, lifetime_generations_used = lifetime_generations_used + 1 WHERE id = ${userId}::uuid AND credits_remaining_daily >= ${cost} AND credits_remaining_monthly >= ${cost} AND lifetime_generations_used < ${FREE_TIER_LIFETIME_LIMITS.generations} RETURNING id`
        : lifetime === "refinements"
          ? await tx<
              { id: string }[]
            >`UPDATE "user" SET credits_remaining_daily = credits_remaining_daily - ${cost}, credits_remaining_monthly = credits_remaining_monthly - ${cost}, lifetime_refinements_used = lifetime_refinements_used + 1 WHERE id = ${userId}::uuid AND credits_remaining_daily >= ${cost} AND credits_remaining_monthly >= ${cost} AND lifetime_refinements_used < ${FREE_TIER_LIFETIME_LIMITS.refinements} RETURNING id`
          : limits.dailyEnforced
            ? await tx<
                { id: string }[]
              >`UPDATE "user" SET credits_remaining_daily = credits_remaining_daily - ${cost}, credits_remaining_monthly = credits_remaining_monthly - ${cost} WHERE id = ${userId}::uuid AND credits_remaining_daily >= ${cost} AND credits_remaining_monthly >= ${cost} RETURNING id`
            : await tx<
                { id: string }[]
              >`UPDATE "user" SET credits_remaining_daily = GREATEST(credits_remaining_daily - ${cost}, 0), credits_remaining_monthly = credits_remaining_monthly - ${cost} WHERE id = ${userId}::uuid AND credits_remaining_monthly >= ${cost} RETURNING id`;
    if (rows.length)
      await tx`INSERT INTO usage_log (id, user_id, game_id, action, credits_charged, lifetime_counter_incremented, succeeded, refunded_at, created_at) VALUES (${logId}, ${userId}::uuid, ${gameId}, ${action}, ${cost}, ${lifetime !== null}, 0, NULL, ${Date.now()})`;
    return rows.length > 0;
  });
  if (!changed) {
    const upfront = checkUpfront({ ...user, tier }, action);
    if (upfront)
      throw new InsufficientCreditsError(
        upfront.kind === "lifetime"
          ? `Free tier lifetime ${action} limit reached. Upgrade for more.`
          : `${upfront.kind === "daily" ? "Daily" : "Monthly"} credit limit reached`,
        upfront.resetAt,
        upfront.kind
      );
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

export async function recordRemix(userId: string, gameId: string): Promise<{ logId: string }> {
  const user = await applyResets(userId);
  if (!user) throw new Error("User not found");
  const guarded = user.tier === "free" && ENFORCE_LIFETIME_LIMITS_FOR_FREE;
  const logId = randomUUID();
  const inserted = await sql.begin(async (tx) => {
    if (guarded) {
      const updated = await tx<
        { id: string }[]
      >`UPDATE "user" SET lifetime_generations_used = lifetime_generations_used + 1 WHERE id = ${userId}::uuid AND lifetime_generations_used < ${FREE_TIER_LIFETIME_LIMITS.generations} RETURNING id`;
      if (!updated.length) return false;
    }
    await tx`INSERT INTO usage_log (id, user_id, game_id, action, credits_charged, lifetime_counter_incremented, succeeded, refunded_at, created_at) VALUES (${logId}, ${userId}::uuid, ${gameId}, 'generation', 0, ${guarded}, 0, NULL, ${Date.now()})`;
    return true;
  });
  if (!inserted)
    throw new InsufficientCreditsError(
      "Free tier lifetime generation limit reached. Upgrade for more.",
      0,
      "lifetime"
    );
  return { logId };
}

export async function refund(
  logId: string,
  opts?: { logger?: FastifyBaseLogger; reason?: RefundReason }
): Promise<void> {
  const row = (
    await db
      .select({
        userId: usageLog.userId,
        creditsCharged: usageLog.creditsCharged,
        lifetimeCounterIncremented: usageLog.lifetimeCounterIncremented,
        action: usageLog.action,
      })
      .from(usageLog)
      .where(eq(usageLog.id, logId))
  )[0];
  if (!row) return;
  const lifetime = row.lifetimeCounterIncremented ? lifetimeCounterFor(row.action as Action) : null;
  const refunded = await sql.begin(async (tx) => {
    const claimed = await tx<
      { user_id: string }[]
    >`UPDATE usage_log SET refunded_at = ${Date.now()} WHERE id = ${logId} AND refunded_at IS NULL RETURNING user_id`;
    if (!claimed.length) return false;
    const tier =
      (await tx<{ tier: Tier }[]>`SELECT tier FROM "user" WHERE id = ${row.userId}::uuid`)[0]
        ?.tier ?? "free";
    const caps = TIER_CREDIT_LIMITS[tier];
    if (lifetime === "generations")
      await tx`UPDATE "user" SET credits_remaining_daily = LEAST(credits_remaining_daily + ${row.creditsCharged}, ${caps.daily}), credits_remaining_monthly = LEAST(credits_remaining_monthly + ${row.creditsCharged}, ${caps.monthly}), lifetime_generations_used = GREATEST(lifetime_generations_used - 1, 0) WHERE id = ${row.userId}::uuid`;
    else if (lifetime === "refinements")
      await tx`UPDATE "user" SET credits_remaining_daily = LEAST(credits_remaining_daily + ${row.creditsCharged}, ${caps.daily}), credits_remaining_monthly = LEAST(credits_remaining_monthly + ${row.creditsCharged}, ${caps.monthly}), lifetime_refinements_used = GREATEST(lifetime_refinements_used - 1, 0) WHERE id = ${row.userId}::uuid`;
    else if (row.creditsCharged > 0)
      await tx`UPDATE "user" SET credits_remaining_daily = LEAST(credits_remaining_daily + ${row.creditsCharged}, ${caps.daily}), credits_remaining_monthly = LEAST(credits_remaining_monthly + ${row.creditsCharged}, ${caps.monthly}) WHERE id = ${row.userId}::uuid`;
    return true;
  });
  if (refunded)
    opts?.logger?.info(
      {
        logId,
        action: row.action,
        amount: row.creditsCharged,
        reason: opts?.reason ?? "llm_error",
      },
      "credits refunded"
    );
}
