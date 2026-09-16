// PostgreSQL transactions must roll back all writes when any statement fails.

import { describe, expect, test } from "bun:test";
import { createTestDb, insertTestUser } from "./test-db.js";

describe("db.transaction atomicity (PostgreSQL)", () => {
  test("rolls back the first insert when the second fails", async () => {
    const testDb = await createTestDb();
    try {
      const { id: userId } = await insertTestUser(testDb);
      const gameId = "game-sync-tx";
      const dupMsgId = "dup-msg";
      const now = Date.now();

      await expect(
        testDb.sql.begin(async (tx) => {
          await tx`INSERT INTO games (id, user_id, title, original_prompt, created_at, updated_at) VALUES (${gameId}, ${userId}::uuid, 't', 'p', ${now}, ${now})`;
          await tx`INSERT INTO messages (id, game_id, kind, content, created_at) VALUES (${dupMsgId}, ${gameId}, 'prompt', 'p', ${now})`;
          await tx`INSERT INTO messages (id, game_id, kind, content, created_at) VALUES (${dupMsgId}, ${gameId}, 'prompt', 'p2', ${now})`;
        })
      ).rejects.toThrow();

      const gameRows = await testDb.sql`SELECT id FROM games WHERE id = ${gameId}`;
      const msgRows = await testDb.sql`SELECT id FROM messages WHERE game_id = ${gameId}`;
      expect(gameRows.length).toBe(0);
      expect(msgRows.length).toBe(0);
    } finally {
      await testDb.close();
    }
  });
});
