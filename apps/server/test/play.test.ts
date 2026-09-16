// Integration tests for the public-sharing routes (publish/unpublish/play/
// remix). We exercise loadPublicGame and recordRemix directly rather than
// spinning up a Fastify instance — the route handlers are thin glue and
// the auth-handler swap for the remix endpoint is covered manually.

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

function insertGame(args: {
  id: string;
  userId: string;
  title?: string;
  isPublic?: boolean;
  publicSlug?: string | null;
  currentCode?: string;
  originalPrompt?: string;
}): Promise<void> {
  const now = Date.now();
  return testDb.client
    .prepare(
      `INSERT INTO games (
        id, user_id, title, current_code, thumbnail, genre, original_prompt,
        is_public, public_slug, published_at, remixed_from_game_id,
        created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?)`
    )
    .run(
      args.id,
      args.userId,
      args.title ?? "test game",
      args.currentCode ?? "<html>code</html>",
      args.originalPrompt ?? "make a game",
      args.isPublic ?? false,
      args.publicSlug ?? null,
      args.isPublic ? now : null,
      now,
      now
    );
}

describe("loadPublicGame", () => {
  test("returns the game payload for a published slug", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    const { id: ownerId } = await insertTestUser(testDb, { tier: "free" });
    const gameId = randomUUID();
    await insertGame({
      id: gameId,
      userId: ownerId,
      title: "Snake clone",
      isPublic: true,
      publicSlug: "abc12345",
      currentCode: "<html>snake</html>",
      originalPrompt: "snake game",
    });

    const game = await loadPublicGame("abc12345");
    expect(game).not.toBeNull();
    expect(game?.id).toBe(gameId);
    expect(game?.title).toBe("Snake clone");
    expect(game?.currentCode).toBe("<html>snake</html>");
    expect(game?.originalPrompt).toBe("snake game");
    expect(game?.ownerDisplayName).toContain("display-");
  });

  test("returns null for a slug that exists but is unpublished", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    const { id: ownerId } = await insertTestUser(testDb, { tier: "free" });
    await insertGame({
      id: randomUUID(),
      userId: ownerId,
      isPublic: false,
      publicSlug: "abc12345",
    });

    expect(await loadPublicGame("abc12345")).toBeNull();
  });

  test("returns null for an unknown slug", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    expect(await loadPublicGame("nonexistent")).toBeNull();
  });

  test("does not expose userId or any internal fields on the public payload", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    const { id: ownerId } = await insertTestUser(testDb, { tier: "free" });
    await insertGame({
      id: randomUUID(),
      userId: ownerId,
      isPublic: true,
      publicSlug: "abc12345",
    });

    const game = await loadPublicGame("abc12345");
    expect(game).not.toBeNull();
    // The TypeScript type already prevents userId/email exposure but be
    // explicit at runtime too: the returned object should not contain a
    // userId key. (Drizzle's typed select strips fields not in the projection.)
    expect((game as Record<string, unknown>).userId).toBeUndefined();
  });
});

describe("publish flow — slug stability and reuse", () => {
  // The publish/unpublish endpoints are thin glue around a few SQL writes;
  // we test the SQL-level behavior directly to verify the contract.
  test("setting a public_slug then unpublishing retains the slug", async () => {
    const { id: ownerId } = await insertTestUser(testDb, { tier: "free" });
    const gameId = randomUUID();
    await insertGame({
      id: gameId,
      userId: ownerId,
      isPublic: false,
      publicSlug: "stableabc",
    });

    // Simulate publish (set isPublic + publishedAt on existing slug)
    await testDb.client
      .prepare("UPDATE games SET is_public = true, published_at = ? WHERE id = ?")
      .run(Date.now(), gameId);

    // Simulate unpublish
    await testDb.client.prepare("UPDATE games SET is_public = false WHERE id = ?").run(gameId);

    const row = await testDb.client
      .query<{ public_slug: string | null; is_public: boolean }, [string]>(
        "SELECT public_slug, is_public FROM games WHERE id = ?"
      )
      .get(gameId);
    expect(row?.public_slug).toBe("stableabc");
    expect(row?.is_public).toBe(false);
  });

  test("public_slug uniqueness is enforced at the DB level", async () => {
    const { id: ownerId } = await insertTestUser(testDb, { tier: "free" });
    await insertGame({ id: randomUUID(), userId: ownerId, publicSlug: "duplicate" });

    await expect(
      insertGame({ id: randomUUID(), userId: ownerId, publicSlug: "duplicate" })
    ).rejects.toThrow();
  });

  test("multiple games can share publicSlug=null", async () => {
    const { id: ownerId } = await insertTestUser(testDb, { tier: "free" });
    await insertGame({ id: randomUUID(), userId: ownerId, publicSlug: null });
    await expect(
      insertGame({ id: randomUUID(), userId: ownerId, publicSlug: null })
    ).resolves.toBeUndefined();
  });
});

describe("recordRemix — lifetime cap interaction", () => {
  test("free user with budget: recordRemix succeeds and increments lifetime counter", async () => {
    const { recordRemix } = await import("../src/services/usage/charge.js");
    const { id: userId } = await insertTestUser(testDb, {
      tier: "free",
      lifetimeGenerationsUsed: 0,
    });
    const gameId = randomUUID();
    await insertGame({ id: gameId, userId, currentCode: "<html></html>" });

    const { logId } = await recordRemix(userId, gameId);
    expect(logId).toBeTruthy();

    const user = await testDb.client
      .query<{ lifetime_generations_used: number }, [string]>(
        `SELECT lifetime_generations_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.lifetime_generations_used).toBe(1);

    const log = await testDb.client
      .query<{ credits_charged: number; lifetime_counter_incremented: boolean }, [string]>(
        "SELECT credits_charged, lifetime_counter_incremented FROM usage_log WHERE id = ?"
      )
      .get(logId);
    expect(log?.credits_charged).toBe(0);
    expect(log?.lifetime_counter_incremented).toBe(true);
  });

  test("free user at lifetime cap: recordRemix throws with kind=lifetime", async () => {
    const { recordRemix, InsufficientCreditsError } = await import(
      "../src/services/usage/charge.js"
    );
    const { id: userId } = await insertTestUser(testDb, {
      tier: "free",
      lifetimeGenerationsUsed: 1, // == cap
    });
    await insertGame({ id: randomUUID(), userId });

    let caught: unknown;
    try {
      await recordRemix(userId, "remix-target");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InsufficientCreditsError);
    expect((caught as InstanceType<typeof InsufficientCreditsError>).kind).toBe("lifetime");
  });

  test("paid tier: recordRemix succeeds without touching lifetime counter", async () => {
    const { recordRemix } = await import("../src/services/usage/charge.js");
    const { id: userId } = await insertTestUser(testDb, {
      tier: "creator",
      lifetimeGenerationsUsed: 100, // way over cap; doesn't matter for paid
    });
    const gameId = randomUUID();
    await insertGame({ id: gameId, userId });

    const { logId } = await recordRemix(userId, gameId);
    expect(logId).toBeTruthy();

    const user = await testDb.client
      .query<{ lifetime_generations_used: number }, [string]>(
        `SELECT lifetime_generations_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.lifetime_generations_used).toBe(100); // unchanged
  });

  test("admin: recordRemix succeeds and inserts a log row with no counter changes", async () => {
    const { recordRemix } = await import("../src/services/usage/charge.js");
    const { id: userId } = await insertTestUser(testDb, { tier: "admin" });
    const gameId = randomUUID();
    await insertGame({ id: gameId, userId });

    const { logId } = await recordRemix(userId, gameId);
    expect(logId).toBeTruthy();

    const log = await testDb.client
      .query<{ credits_charged: number; lifetime_counter_incremented: boolean }, [string]>(
        "SELECT credits_charged, lifetime_counter_incremented FROM usage_log WHERE id = ?"
      )
      .get(logId);
    expect(log?.credits_charged).toBe(0);
    expect(log?.lifetime_counter_incremented).toBe(false);
  });
});
