// Integration tests for DELETE /api/me, focused on the like_count
// reconciliation: deleting a user cascades away their game_likes rows, so the
// handler must decrement like_count on the games they had liked first —
// otherwise the denormalized counter (which drives the Discover ranking)
// permanently overstates reality.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { createTestDb, insertTestUser, type TestDb } from "./test-db.js";

let testDb: TestDb;
let app: FastifyInstance;
let stubUserId = "user-stub";

async function buildApp() {
  const fastify = Fastify({ logger: false });
  fastify.addHook("preHandler", async (request) => {
    (request as unknown as { authSession: { user: { id: string } } }).authSession = {
      user: { id: stubUserId },
    };
  });
  const { meRoutes } = await import("../src/routes/me.js");
  await fastify.register(meRoutes);
  return fastify;
}

beforeEach(async () => {
  testDb = createTestDb();
  mock.module("../src/lib/db.ts", () => ({
    db: testDb.db,
    sqlite: testDb.sqlite,
  }));
  // auth.api.signOut is called first in the delete handler; it's wrapped in a
  // try/catch that continues on failure, so a no-op stub is enough.
  mock.module("../src/lib/auth.ts", () => ({
    auth: { api: { signOut: async () => undefined } },
  }));
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  testDb.close();
});

function insertGame(args: { userId: string; publicSlug: string; likeCount?: number }): string {
  const id = randomUUID();
  const now = Date.now();
  testDb.sqlite
    .prepare(
      `INSERT INTO games (
        id, user_id, title, current_code, thumbnail, genre,
        original_prompt, is_public, public_slug, published_at,
        remixed_from_game_id, play_count, like_count, created_at, updated_at
      ) VALUES (?, ?, 't', '<html>', NULL, NULL, 'p', 1, ?, ?, NULL, 0, ?, ?, ?)`
    )
    .run(id, args.userId, args.publicSlug, now, args.likeCount ?? 0, now, now);
  return id;
}

function insertLike(gameId: string, userId: string) {
  testDb.sqlite
    .prepare("INSERT INTO game_likes (game_id, user_id, created_at) VALUES (?, ?, ?)")
    .run(gameId, userId, Date.now());
}

function likeCountOf(gameId: string): number | undefined {
  return testDb.sqlite
    .query<{ like_count: number }, [string]>("SELECT like_count FROM games WHERE id = ?")
    .get(gameId)?.like_count;
}

describe("DELETE /api/me — like_count reconciliation", () => {
  test("decrements like_count on other users' games the deleted user had liked", async () => {
    const { id: owner } = insertTestUser(testDb.sqlite, { email: "owner@test" });
    const { id: leaver } = insertTestUser(testDb.sqlite, { email: "leaver@test" });
    stubUserId = leaver;

    // Owner's public game, liked by the leaver (count reflects that like).
    const game = insertGame({ userId: owner, publicSlug: "ownr0001", likeCount: 1 });
    insertLike(game, leaver);

    const res = await app.inject({ method: "DELETE", url: "/api/me" });

    expect(res.statusCode).toBe(204);
    // The leaver's like row cascaded away; the counter must have been
    // decremented to match (was 1 -> 0), not left stale at 1.
    expect(likeCountOf(game)).toBe(0);
  });

  test("does not drive like_count below zero", async () => {
    const { id: owner } = insertTestUser(testDb.sqlite, { email: "owner2@test" });
    const { id: leaver } = insertTestUser(testDb.sqlite, { email: "leaver2@test" });
    stubUserId = leaver;

    // Counter already 0 (drifted low) but a like row exists — MAX(...,0) clamps.
    const game = insertGame({ userId: owner, publicSlug: "ownr0002", likeCount: 0 });
    insertLike(game, leaver);

    const res = await app.inject({ method: "DELETE", url: "/api/me" });

    expect(res.statusCode).toBe(204);
    expect(likeCountOf(game)).toBe(0);
  });

  test("leaves unrelated games' counters untouched", async () => {
    const { id: owner } = insertTestUser(testDb.sqlite, { email: "owner3@test" });
    const { id: leaver } = insertTestUser(testDb.sqlite, { email: "leaver3@test" });
    stubUserId = leaver;

    const liked = insertGame({ userId: owner, publicSlug: "lik00001", likeCount: 5 });
    const notLiked = insertGame({ userId: owner, publicSlug: "notl0001", likeCount: 5 });
    insertLike(liked, leaver);

    const res = await app.inject({ method: "DELETE", url: "/api/me" });

    expect(res.statusCode).toBe(204);
    expect(likeCountOf(liked)).toBe(4);
    expect(likeCountOf(notLiked)).toBe(5);
  });
});
