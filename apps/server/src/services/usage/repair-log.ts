// Repair bypasses the charge service in `usage/charge.ts` because repairs are
// free per SPEC §10. The log row is for observability only (SPEC §5, §17).

import { randomUUID } from "node:crypto";
import { usageLog } from "@arcadeai/db";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";

/**
 * Insert a usage_log row for a repair attempt. credits_charged is always 0.
 * Returns the logId for subsequent markRepairSucceeded calls.
 */
export async function logRepair(userId: string, gameId: string): Promise<{ logId: string }> {
  const logId = randomUUID();
  await db.insert(usageLog).values({
    id: logId,
    userId,
    gameId,
    action: "repair",
    creditsCharged: 0,
    succeeded: 0,
    refundedAt: null,
    createdAt: Date.now(),
  });
  return { logId };
}

/** Mark a repair attempt as succeeded. Idempotent. */
export async function markRepairSucceeded(logId: string): Promise<void> {
  await db.update(usageLog).set({ succeeded: 1 }).where(eq(usageLog.id, logId));
}
