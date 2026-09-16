// Tests for services/usage/reconcile.ts.
//
// deduct() charges and increments the lifetime counter BEFORE the LLM call, and
// only a handler that runs to completion converts the usage_log row into
// markSucceeded or refund. A process killed mid-stream (deploy, OOM, orchestrator
// kill timeout) strands the row at succeeded=0 / refunded_at=NULL forever.
//
// On the free tier that permanently consumes the single lifetime generation, so
// the reconciliation sweep is what stands between an ops event and a user who
// can never generate again.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTestDb, insertTestUser, type TestDb } from "./test-db.js";

let testDb: TestDb;

const CUTOFF_MS = 15 * 60_000;

beforeEach(async () => {
  testDb = await createTestDb();
  mock.module("../src/lib/db.ts", () => ({
    db: testDb.db,
    sql: testDb.sql,
  }));
});

afterEach(async () => {
  await testDb.close();
});

async function readUser(userId: string) {
  const [user] = await testDb.sql<
    { d: number; m: number; g: number }[]
  >`SELECT credits_remaining_daily d, credits_remaining_monthly m, lifetime_generations_used g FROM "user" WHERE id = ${userId}::uuid`;
  return user;
}

/** Backdate a usage_log row so the sweep considers it dead. */
async function ageRow(logId: string, ms: number) {
  await testDb.sql`UPDATE usage_log SET created_at = ${Date.now() - ms} WHERE id = ${logId}`;
}

describe("reconcileStrandedStreams", () => {
  test("refunds credits and the lifetime counter for an abandoned generation", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { reconcileStrandedStreams } = await import("../src/services/usage/reconcile.js");
    const { id: userId } = await insertTestUser(testDb, { tier: "free" });

    const before = await readUser(userId);
    const { logId } = await deduct(userId, "generation", null);

    const charged = await readUser(userId);
    expect(charged.m).toBe(before.m - 200);
    expect(charged.g).toBe(before.g + 1);

    // The process dies here — no markSucceeded, no refund.
    await ageRow(logId, CUTOFF_MS + 60_000);

    const refunded = await reconcileStrandedStreams({ cutoffMs: CUTOFF_MS });
    expect(refunded).toBe(1);

    const after = await readUser(userId);
    expect(after.m).toBe(before.m);
    expect(after.d).toBe(before.d);
    // Critically: the free tier's single lifetime generation is given back.
    expect(after.g).toBe(before.g);
  });

  test("leaves a live in-flight row alone", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { reconcileStrandedStreams } = await import("../src/services/usage/reconcile.js");
    const { id: userId } = await insertTestUser(testDb, { tier: "free" });

    const { logId } = await deduct(userId, "generation", null);
    const charged = await readUser(userId);

    // Fresh row — a stream that is still running, possibly on another instance.
    const refunded = await reconcileStrandedStreams({ cutoffMs: CUTOFF_MS });
    expect(refunded).toBe(0);
    expect(await readUser(userId)).toEqual(charged);

    const [row] = await testDb.sql<
      { refunded_at: number | null }[]
    >`SELECT refunded_at FROM usage_log WHERE id = ${logId}`;
    expect(row.refunded_at).toBeNull();
  });

  test("ignores rows that already settled", async () => {
    const { deduct, refund } = await import("../src/services/usage/charge.js");
    const { markSucceeded } = await import("../src/services/usage/charge.js");
    const { reconcileStrandedStreams } = await import("../src/services/usage/reconcile.js");
    const { id: userId } = await insertTestUser(testDb, { tier: "free" });

    const succeeded = await deduct(userId, "generation", null);
    await markSucceeded(succeeded.logId);
    await ageRow(succeeded.logId, CUTOFF_MS + 60_000);

    const alreadyRefunded = await deduct(userId, "refinement", null);
    await refund(alreadyRefunded.logId, { reason: "llm_error" });
    await ageRow(alreadyRefunded.logId, CUTOFF_MS + 60_000);

    const snapshot = await readUser(userId);
    const refundedCount = await reconcileStrandedStreams({
      cutoffMs: CUTOFF_MS,
    });

    // Neither row is eligible, and no balance moves.
    expect(refundedCount).toBe(0);
    expect(await readUser(userId)).toEqual(snapshot);
  });

  test("is idempotent across repeated sweeps", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { reconcileStrandedStreams } = await import("../src/services/usage/reconcile.js");
    const { id: userId } = await insertTestUser(testDb, { tier: "free" });

    const before = await readUser(userId);
    const { logId } = await deduct(userId, "generation", null);
    await ageRow(logId, CUTOFF_MS + 60_000);

    expect(await reconcileStrandedStreams({ cutoffMs: CUTOFF_MS })).toBe(1);
    const afterFirst = await readUser(userId);
    // A second sweep must not double-credit.
    expect(await reconcileStrandedStreams({ cutoffMs: CUTOFF_MS })).toBe(0);

    expect(await readUser(userId)).toEqual(afterFirst);
    expect(afterFirst).toEqual(before);
  });
});
