// Regression guards for the "game deleted while its stream is still running"
// path.
//
// DELETE /api/games/:id has no in-flight guard (unlike undo), and
// usage_log.game_id is ON DELETE SET NULL, so the billing row outlives the
// game. The stream then finishes and tries to persist. A 0-row UPDATE is not
// an error in SQLite, so before the persist writes became self-verifying the
// stream reported success and the user kept the charge -- plus a burned
// lifetime generation, which is capped at 1 on the free tier -- for a game
// that no longer exists.
//
// These tests pin the two facts that fix depends on: the write really does
// affect 0 rows, and refund() still works on a row whose game_id went NULL.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTestDb, insertTestUser, type TestDb } from "./test-db.js";

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

function insertGame(userId: string, id = "game-1") {
  testDb.sqlite
    .prepare(
      `INSERT INTO games (id, user_id, title, original_prompt, current_code, is_public,
                          like_count, play_count, created_at, updated_at)
       VALUES (?, ?, 'T', 'p', '', 0, 0, 0, ?, ?)`
    )
    .run(id, userId, Date.now(), Date.now());
  return id;
}

describe("deleting a game mid-stream", () => {
  test("the usage_log row survives with game_id set to NULL", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, { tier: "free" });
    const gameId = insertGame(userId);

    const { logId } = await deduct(userId, "generation", gameId);
    testDb.sqlite.prepare("DELETE FROM games WHERE id = ?").run(gameId);

    const row = testDb.sqlite
      .prepare("SELECT game_id, succeeded, refunded_at FROM usage_log WHERE id = ?")
      .get(logId) as { game_id: string | null; succeeded: number; refunded_at: number | null };

    // ON DELETE SET NULL: the billing record must outlive the game so the
    // charge stays auditable and refundable.
    expect(row.game_id).toBeNull();
    expect(row.succeeded).toBe(0);
    expect(row.refunded_at).toBeNull();
  });

  test("persisting to the deleted game affects 0 rows without throwing", async () => {
    const { games } = await import("@arcadeai/db");
    const { and, eq } = await import("drizzle-orm");
    const { id: userId } = insertTestUser(testDb.sqlite, { tier: "free" });
    const gameId = insertGame(userId);
    testDb.sqlite.prepare("DELETE FROM games WHERE id = ?").run(gameId);

    // This is the shape the stream handlers use. It must report the miss
    // rather than silently succeeding.
    const persisted = await testDb.db
      .update(games)
      .set({ currentCode: "<!DOCTYPE html>", updatedAt: Date.now() })
      .where(and(eq(games.id, gameId), eq(games.userId, userId)))
      .returning({ id: games.id });

    expect(persisted).toHaveLength(0);
  });

  test("refund restores credits and the lifetime counter after the game is gone", async () => {
    const { deduct, refund } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, { tier: "free" });
    const gameId = insertGame(userId);

    const before = testDb.sqlite
      .prepare(
        `SELECT credits_remaining_daily d, credits_remaining_monthly m,
                lifetime_generations_used g FROM "user" WHERE id = ?`
      )
      .get(userId) as { d: number; m: number; g: number };

    const { logId } = await deduct(userId, "generation", gameId);
    testDb.sqlite.prepare("DELETE FROM games WHERE id = ?").run(gameId);

    const charged = testDb.sqlite
      .prepare(`SELECT credits_remaining_monthly m, lifetime_generations_used g
                FROM "user" WHERE id = ?`)
      .get(userId) as { m: number; g: number };
    expect(charged.m).toBeLessThan(before.m);
    expect(charged.g).toBe(before.g + 1);

    // The self-verifying write turns the vanished row into a stream error,
    // which routes here. Credits and the lifetime counter must both come back.
    await refund(logId, { reason: "persistence_error" });

    const after = testDb.sqlite
      .prepare(
        `SELECT credits_remaining_daily d, credits_remaining_monthly m,
                lifetime_generations_used g FROM "user" WHERE id = ?`
      )
      .get(userId) as { d: number; m: number; g: number };

    expect(after.d).toBe(before.d);
    expect(after.m).toBe(before.m);
    expect(after.g).toBe(before.g);
  });
});
