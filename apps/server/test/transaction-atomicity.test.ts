// Regression test for the db.transaction atomicity fix.
//
// Drizzle's bun-sqlite driver wraps a *synchronous* transaction callback in
// bun's native BEGIN/COMMIT/ROLLBACK. An *async* callback, however, commits at
// the first `await` and runs the rest in autocommit mode — so a throw after
// the first statement does NOT roll back. The multi-write transactions in
// games.ts (generate), play.ts (remix), me.ts (account delete), and likes.ts
// rely on rollback, so they were converted to synchronous callbacks.
//
// This test pins that behavior: a synchronous transaction whose second insert
// violates a constraint must leave the table empty (full rollback), and an
// async transaction must NOT (documenting the trap we're avoiding).

import { describe, expect, test } from "bun:test";
import { games, messages } from "@arcadeai/db";
import { eq } from "drizzle-orm";
import { createTestDb, insertTestUser } from "./test-db.js";

describe("db.transaction atomicity (bun-sqlite)", () => {
  test("synchronous callback rolls back the first insert when the second fails", () => {
    const testDb = createTestDb();
    try {
      const { id: userId } = insertTestUser(testDb.sqlite);
      const gameId = "game-sync-tx";
      const dupMsgId = "dup-msg";
      const now = Date.now();

      expect(() => {
        testDb.db.transaction((tx) => {
          tx.insert(games)
            .values({
              id: gameId,
              userId,
              title: "t",
              currentCode: "",
              thumbnail: null,
              genre: null,
              originalPrompt: "p",
              createdAt: now,
              updatedAt: now,
            })
            .run();

          // First message insert succeeds...
          tx.insert(messages)
            .values({ id: dupMsgId, gameId, kind: "prompt", content: "p", createdAt: now })
            .run();
          // ...second collides on the primary key and throws inside the tx.
          tx.insert(messages)
            .values({ id: dupMsgId, gameId, kind: "prompt", content: "p2", createdAt: now })
            .run();
        });
      }).toThrow();

      // The whole transaction must have rolled back: no game, no messages.
      const gameRows = testDb.db.select().from(games).where(eq(games.id, gameId)).all();
      const msgRows = testDb.db.select().from(messages).where(eq(messages.gameId, gameId)).all();
      expect(gameRows.length).toBe(0);
      expect(msgRows.length).toBe(0);
    } finally {
      testDb.close();
    }
  });

  test("async callback does NOT roll back (the trap the fix avoids)", async () => {
    const testDb = createTestDb();
    try {
      const { id: userId } = insertTestUser(testDb.sqlite);
      const gameId = "game-async-tx";
      const dupMsgId = "dup-msg-async";
      const now = Date.now();

      let threw = false;
      try {
        await testDb.db.transaction(async (tx) => {
          await tx.insert(games).values({
            id: gameId,
            userId,
            title: "t",
            currentCode: "",
            thumbnail: null,
            genre: null,
            originalPrompt: "p",
            createdAt: now,
            updatedAt: now,
          });
          await tx
            .insert(messages)
            .values({ id: dupMsgId, gameId, kind: "prompt", content: "p", createdAt: now });
          await tx
            .insert(messages)
            .values({ id: dupMsgId, gameId, kind: "prompt", content: "p2", createdAt: now });
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);
      // Demonstrates the bug: the game row committed at the first await and was
      // NOT rolled back. This is exactly why the production code must use a
      // synchronous callback.
      const gameRows = testDb.db.select().from(games).where(eq(games.id, gameId)).all();
      expect(gameRows.length).toBe(1);
    } finally {
      testDb.close();
    }
  });
});
