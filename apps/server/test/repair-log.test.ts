// Unit tests for services/usage/repair-log — observability-only log rows.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createTestDb, insertTestUser, type TestDb } from "./test-db.js";

let testDb: TestDb;

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

async function insertGame(userId: string): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await testDb.sql`INSERT INTO games (id, user_id, title, current_code, thumbnail, genre, original_prompt, is_public, public_slug, published_at, remixed_from_game_id, created_at, updated_at) VALUES (${id}, ${userId}::uuid, 't', '<html>', NULL, NULL, 'p', false, NULL, NULL, NULL, ${now}, ${now})`;
  return id;
}

describe("logRepair", () => {
  test("inserts a usage_log row with credits_charged = 0 and succeeded = 0", async () => {
    const { logRepair } = await import("../src/services/usage/repair-log.js");
    const { id: userId } = await insertTestUser(testDb);
    const gameId = await insertGame(userId);

    const { logId } = await logRepair(userId, gameId);

    const [row] = await testDb.sql<
      {
        credits_charged: number;
        succeeded: number;
        action: string;
        user_id: string;
        game_id: string;
        refunded_at: number | null;
      }[]
    >`SELECT credits_charged, succeeded, action, user_id, game_id, refunded_at FROM usage_log WHERE id = ${logId}`;

    expect(row).toBeTruthy();
    expect(row?.credits_charged).toBe(0);
    expect(row?.succeeded).toBe(0);
    expect(row?.action).toBe("repair");
    expect(row?.user_id).toBe(userId);
    expect(row?.game_id).toBe(gameId);
    expect(row?.refunded_at).toBeNull();
  });
});

describe("markRepairSucceeded", () => {
  test("flips succeeded from 0 to 1", async () => {
    const { logRepair, markRepairSucceeded } = await import("../src/services/usage/repair-log.js");
    const { id: userId } = await insertTestUser(testDb);
    const gameId = await insertGame(userId);
    const { logId } = await logRepair(userId, gameId);

    await markRepairSucceeded(logId);

    const [row] = await testDb.sql<
      { succeeded: number }[]
    >`SELECT succeeded FROM usage_log WHERE id = ${logId}`;
    expect(row?.succeeded).toBe(1);
  });

  test("is idempotent (calling twice keeps succeeded = 1)", async () => {
    const { logRepair, markRepairSucceeded } = await import("../src/services/usage/repair-log.js");
    const { id: userId } = await insertTestUser(testDb);
    const gameId = await insertGame(userId);
    const { logId } = await logRepair(userId, gameId);

    await markRepairSucceeded(logId);
    await markRepairSucceeded(logId);

    const [row] = await testDb.sql<
      { succeeded: number }[]
    >`SELECT succeeded FROM usage_log WHERE id = ${logId}`;
    expect(row?.succeeded).toBe(1);
  });

  test("silently no-ops on an unknown logId (DB UPDATE ... WHERE no match)", async () => {
    const { markRepairSucceeded } = await import("../src/services/usage/repair-log.js");
    // Should not throw.
    await markRepairSucceeded("does-not-exist");
  });
});

describe("markRepairFailed", () => {
  test("terminalizes the row by setting refunded_at (keeps succeeded = 0)", async () => {
    const { logRepair, markRepairFailed } = await import("../src/services/usage/repair-log.js");
    const { id: userId } = await insertTestUser(testDb);
    const gameId = await insertGame(userId);
    const { logId } = await logRepair(userId, gameId);

    await markRepairFailed(logId);

    // The undo route's in-flight predicate is `succeeded = 0 AND
    // refunded_at IS NULL`. A failed repair that never terminalized
    // matched it forever, permanently 409-ing undo for the game.
    const [row] = await testDb.sql<
      { succeeded: number; refunded_at: number | null }[]
    >`SELECT succeeded, refunded_at FROM usage_log WHERE id = ${logId}`;
    expect(row?.succeeded).toBe(0);
    expect(row?.refunded_at).not.toBeNull();
  });

  test("is idempotent — a second call does not overwrite refunded_at", async () => {
    const { logRepair, markRepairFailed } = await import("../src/services/usage/repair-log.js");
    const { id: userId } = await insertTestUser(testDb);
    const gameId = await insertGame(userId);
    const { logId } = await logRepair(userId, gameId);

    await markRepairFailed(logId);
    // Plant a sentinel timestamp rather than comparing Date.now()-derived
    // values: both calls can land in the same millisecond, which would let
    // an unguarded overwrite produce an identical value and pass anyway.
    const SENTINEL = 12345;
    await testDb.sql`UPDATE usage_log SET refunded_at = ${SENTINEL} WHERE id = ${logId}`;

    await markRepairFailed(logId);
    const [second] = await testDb.sql<
      { refunded_at: number | null }[]
    >`SELECT refunded_at::float8 refunded_at FROM usage_log WHERE id = ${logId}`;

    // The `refunded_at IS NULL` guard must leave the existing value alone.
    expect(second?.refunded_at).toBe(SENTINEL);
  });
});
