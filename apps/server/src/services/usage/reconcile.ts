import { usageLog } from "@arcadeai/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db } from "../../lib/db.js";
import { refund } from "./charge.js";

/**
 * Refund `usage_log` rows that were stranded in flight by a process that died
 * mid-stream.
 *
 * `deduct()` writes the log row (and increments the lifetime counter) BEFORE
 * the LLM call, and only the handler running to completion converts that row
 * into `markSucceeded` or `refund`. A hard kill in between leaves it at
 * `succeeded = 0 AND refunded_at IS NULL` forever — nothing else in the system
 * reconciles it.
 *
 * That is not hypothetical. The graceful-shutdown drain in index.ts waits up to
 * 30s for streams to finish, but an LLM call runs up to 180s, and an
 * orchestrator's kill timeout (Fly's default is 5s) can cut the drain short
 * regardless. Every deploy is an opportunity.
 *
 * The user-visible damage is severe on the free tier, which allows exactly one
 * lifetime generation: the credits are gone, `lifetime_generations_used` stays
 * incremented so every future generate returns 402 FREE_TIER_EXHAUSTED, and the
 * orphaned game has `current_code = ''` so refine and publish both 400. There is
 * no self-service path out of that state.
 *
 * `refund()` is idempotent (it claims `refunded_at` in a conditional UPDATE), so
 * racing this against a live handler is safe: whichever claims first wins and
 * the other no-ops.
 *
 * @param cutoffMs Only rows older than this are considered dead. Callers pass
 *   STALE_STREAM_CUTOFF_MS, which comfortably exceeds the LLM timeout plus
 *   pre/post-stream work, so a genuinely live stream is never swept — including
 *   one owned by another instance.
 */
export async function reconcileStrandedStreams(opts: {
  cutoffMs: number;
  logger?: FastifyBaseLogger;
}): Promise<number> {
  const { cutoffMs, logger } = opts;
  const cutoff = Date.now() - cutoffMs;

  let stranded: { id: string; userId: string; action: string }[];
  try {
    stranded = await db
      .select({ id: usageLog.id, userId: usageLog.userId, action: usageLog.action })
      .from(usageLog)
      .where(
        and(eq(usageLog.succeeded, 0), isNull(usageLog.refundedAt), lt(usageLog.createdAt, cutoff))
      );
  } catch (err) {
    // Never let reconciliation take the process down — it runs at startup.
    logger?.error({ err }, "stranded-stream reconciliation query failed");
    return 0;
  }

  if (stranded.length === 0) return 0;

  let refunded = 0;
  for (const row of stranded) {
    try {
      await refund(row.id, { logger, reason: "stranded" });
      refunded++;
    } catch (err) {
      logger?.error({ err, logId: row.id }, "failed to refund stranded usage_log row");
    }
  }

  logger?.warn(
    { found: stranded.length, refunded },
    "refunded usage_log rows stranded by an interrupted stream"
  );
  return refunded;
}
