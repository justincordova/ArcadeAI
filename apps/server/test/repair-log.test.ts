// Unit tests for services/usage/repair-log — observability-only log rows.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type TestDb, createTestDb, insertTestUser } from "./test-db.js";

let testDb: TestDb;

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

function insertGame(userId: string): string {
  const id = randomUUID();
  const now = Date.now();
  testDb.sqlite
    .prepare(
      `INSERT INTO games (
        id, user_id, title, current_code, thumbnail, genre,
        original_prompt, is_public, public_slug, published_at,
        remixed_from_game_id, created_at, updated_at
      ) VALUES (?, ?, 't', '<html>', NULL, NULL, 'p', 0, NULL, NULL, NULL, ?, ?)`
    )
    .run(id, userId, now, now);
  return id;
}

describe("logRepair", () => {
  test("inserts a usage_log row with credits_charged = 0 and succeeded = 0", async () => {
    const { logRepair } = await import("../src/services/usage/repair-log.js");
    const { id: userId } = insertTestUser(testDb.sqlite);
    const gameId = insertGame(userId);

    const { logId } = await logRepair(userId, gameId);

    const row = testDb.sqlite
      .query<
        {
          credits_charged: number;
          succeeded: number;
          action: string;
          user_id: string;
          game_id: string;
          refunded_at: number | null;
        },
        [string]
      >(
        "SELECT credits_charged, succeeded, action, user_id, game_id, refunded_at FROM usage_log WHERE id = ?"
      )
      .get(logId);

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
    const { id: userId } = insertTestUser(testDb.sqlite);
    const gameId = insertGame(userId);
    const { logId } = await logRepair(userId, gameId);

    await markRepairSucceeded(logId);

    const row = testDb.sqlite
      .query<{ succeeded: number }, [string]>("SELECT succeeded FROM usage_log WHERE id = ?")
      .get(logId);
    expect(row?.succeeded).toBe(1);
  });

  test("is idempotent (calling twice keeps succeeded = 1)", async () => {
    const { logRepair, markRepairSucceeded } = await import("../src/services/usage/repair-log.js");
    const { id: userId } = insertTestUser(testDb.sqlite);
    const gameId = insertGame(userId);
    const { logId } = await logRepair(userId, gameId);

    await markRepairSucceeded(logId);
    await markRepairSucceeded(logId);

    const row = testDb.sqlite
      .query<{ succeeded: number }, [string]>("SELECT succeeded FROM usage_log WHERE id = ?")
      .get(logId);
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
    const { id: userId } = insertTestUser(testDb.sqlite);
    const gameId = insertGame(userId);
    const { logId } = await logRepair(userId, gameId);

    await markRepairFailed(logId);

    // The undo route's in-flight predicate is `succeeded = 0 AND
    // refunded_at IS NULL`. A failed repair that never terminalized
    // matched it forever, permanently 409-ing undo for the game.
    const row = testDb.sqlite
      .query<{ succeeded: number; refunded_at: number | null }, [string]>(
        "SELECT succeeded, refunded_at FROM usage_log WHERE id = ?"
      )
      .get(logId);
    expect(row?.succeeded).toBe(0);
    expect(row?.refunded_at).not.toBeNull();
  });

  test("is idempotent — a second call does not overwrite refunded_at", async () => {
    const { logRepair, markRepairFailed } = await import("../src/services/usage/repair-log.js");
    const { id: userId } = insertTestUser(testDb.sqlite);
    const gameId = insertGame(userId);
    const { logId } = await logRepair(userId, gameId);

    await markRepairFailed(logId);
    // Plant a sentinel timestamp rather than comparing Date.now()-derived
    // values: both calls can land in the same millisecond, which would let
    // an unguarded overwrite produce an identical value and pass anyway.
    const SENTINEL = 12345;
    testDb.sqlite.query("UPDATE usage_log SET refunded_at = ? WHERE id = ?").run(SENTINEL, logId);

    await markRepairFailed(logId);
    const second = testDb.sqlite
      .query<{ refunded_at: number | null }, [string]>(
        "SELECT refunded_at FROM usage_log WHERE id = ?"
      )
      .get(logId);

    // The `refunded_at IS NULL` guard must leave the existing value alone.
    expect(second?.refunded_at).toBe(SENTINEL);
  });
});
