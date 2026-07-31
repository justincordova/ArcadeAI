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

beforeEach(() => {
  testDb = createTestDb();
  mock.module("../src/lib/db.ts", () => ({
    db: testDb.db,
    sqlite: testDb.sqlite,
  }));
});

afterEach(() => {
  testDb.close();
});

function readUser(userId: string) {
  return testDb.sqlite
    .prepare(
      `SELECT credits_remaining_daily d, credits_remaining_monthly m,
              lifetime_generations_used g FROM "user" WHERE id = ?`
    )
    .get(userId) as { d: number; m: number; g: number };
}

/** Backdate a usage_log row so the sweep considers it dead. */
function ageRow(logId: string, ms: number) {
  testDb.sqlite
    .prepare("UPDATE usage_log SET created_at = ? WHERE id = ?")
    .run(Date.now() - ms, logId);
}

describe("reconcileStrandedStreams", () => {
  test("refunds credits and the lifetime counter for an abandoned generation", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { reconcileStrandedStreams } = await import("../src/services/usage/reconcile.js");
    const { id: userId } = insertTestUser(testDb.sqlite, { tier: "free" });

    const before = readUser(userId);
    const { logId } = await deduct(userId, "generation", null);

    const charged = readUser(userId);
    expect(charged.m).toBe(before.m - 200);
    expect(charged.g).toBe(before.g + 1);

    // The process dies here — no markSucceeded, no refund.
    ageRow(logId, CUTOFF_MS + 60_000);

    const refunded = await reconcileStrandedStreams({ cutoffMs: CUTOFF_MS });
    expect(refunded).toBe(1);

    const after = readUser(userId);
    expect(after.m).toBe(before.m);
    expect(after.d).toBe(before.d);
    // Critically: the free tier's single lifetime generation is given back.
    expect(after.g).toBe(before.g);
  });

  test("leaves a live in-flight row alone", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { reconcileStrandedStreams } = await import("../src/services/usage/reconcile.js");
    const { id: userId } = insertTestUser(testDb.sqlite, { tier: "free" });

    const { logId } = await deduct(userId, "generation", null);
    const charged = readUser(userId);

    // Fresh row — a stream that is still running, possibly on another instance.
    const refunded = await reconcileStrandedStreams({ cutoffMs: CUTOFF_MS });
    expect(refunded).toBe(0);
    expect(readUser(userId)).toEqual(charged);

    const row = testDb.sqlite
      .prepare("SELECT refunded_at FROM usage_log WHERE id = ?")
      .get(logId) as { refunded_at: number | null };
    expect(row.refunded_at).toBeNull();
  });

  test("ignores rows that already settled", async () => {
    const { deduct, refund } = await import("../src/services/usage/charge.js");
    const { markSucceeded } = await import("../src/services/usage/charge.js");
    const { reconcileStrandedStreams } = await import("../src/services/usage/reconcile.js");
    const { id: userId } = insertTestUser(testDb.sqlite, { tier: "free" });

    const succeeded = await deduct(userId, "generation", null);
    await markSucceeded(succeeded.logId);
    ageRow(succeeded.logId, CUTOFF_MS + 60_000);

    const alreadyRefunded = await deduct(userId, "refinement", null);
    await refund(alreadyRefunded.logId, { reason: "llm_error" });
    ageRow(alreadyRefunded.logId, CUTOFF_MS + 60_000);

    const snapshot = readUser(userId);
    const refundedCount = await reconcileStrandedStreams({ cutoffMs: CUTOFF_MS });

    // Neither row is eligible, and no balance moves.
    expect(refundedCount).toBe(0);
    expect(readUser(userId)).toEqual(snapshot);
  });

  test("is idempotent across repeated sweeps", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { reconcileStrandedStreams } = await import("../src/services/usage/reconcile.js");
    const { id: userId } = insertTestUser(testDb.sqlite, { tier: "free" });

    const before = readUser(userId);
    const { logId } = await deduct(userId, "generation", null);
    ageRow(logId, CUTOFF_MS + 60_000);

    expect(await reconcileStrandedStreams({ cutoffMs: CUTOFF_MS })).toBe(1);
    const afterFirst = readUser(userId);
    // A second sweep must not double-credit.
    expect(await reconcileStrandedStreams({ cutoffMs: CUTOFF_MS })).toBe(0);

    expect(readUser(userId)).toEqual(afterFirst);
    expect(afterFirst).toEqual(before);
  });
});
