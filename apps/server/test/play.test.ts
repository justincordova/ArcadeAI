// Integration tests for the public-sharing routes (publish/unpublish/play/
// remix). We exercise loadPublicGame and recordRemix directly rather than
// spinning up a Fastify instance — the route handlers are thin glue and
// the auth-handler swap for the remix endpoint is covered manually.

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

function insertGame(args: {
  id: string;
  userId: string;
  title?: string;
  isPublic?: boolean;
  publicSlug?: string | null;
  currentCode?: string;
  originalPrompt?: string;
}): void {
  const now = Date.now();
  testDb.sqlite
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
      args.isPublic ? 1 : 0,
      args.publicSlug ?? null,
      args.isPublic ? now : null,
      now,
      now
    );
}

describe("loadPublicGame", () => {
  test("returns the game payload for a published slug", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    const { id: ownerId } = insertTestUser(testDb.sqlite, { tier: "free" });
    insertGame({
      id: "game-1",
      userId: ownerId,
      title: "Snake clone",
      isPublic: true,
      publicSlug: "abc12345",
      currentCode: "<html>snake</html>",
      originalPrompt: "snake game",
    });

    const game = await loadPublicGame("abc12345");
    expect(game).not.toBeNull();
    expect(game?.id).toBe("game-1");
    expect(game?.title).toBe("Snake clone");
    expect(game?.currentCode).toBe("<html>snake</html>");
    expect(game?.originalPrompt).toBe("snake game");
    expect(game?.ownerDisplayName).toContain("display-");
  });

  test("returns null for a slug that exists but is unpublished", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    const { id: ownerId } = insertTestUser(testDb.sqlite, { tier: "free" });
    insertGame({
      id: "game-1",
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
    const { id: ownerId } = insertTestUser(testDb.sqlite, { tier: "free" });
    insertGame({
      id: "game-1",
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
    const { id: ownerId } = insertTestUser(testDb.sqlite, { tier: "free" });
    insertGame({
      id: "game-1",
      userId: ownerId,
      isPublic: false,
      publicSlug: "stableabc",
    });

    // Simulate publish (set isPublic + publishedAt on existing slug)
    testDb.sqlite
      .prepare("UPDATE games SET is_public = 1, published_at = ? WHERE id = ?")
      .run(Date.now(), "game-1");

    // Simulate unpublish
    testDb.sqlite.prepare("UPDATE games SET is_public = 0 WHERE id = ?").run("game-1");

    const row = testDb.sqlite
      .query<{ public_slug: string | null; is_public: number }, [string]>(
        "SELECT public_slug, is_public FROM games WHERE id = ?"
      )
      .get("game-1");
    expect(row?.public_slug).toBe("stableabc");
    expect(row?.is_public).toBe(0);
  });

  test("public_slug uniqueness is enforced at the DB level", () => {
    const { id: ownerId } = insertTestUser(testDb.sqlite, { tier: "free" });
    insertGame({ id: "g1", userId: ownerId, publicSlug: "duplicate" });

    expect(() => {
      insertGame({ id: "g2", userId: ownerId, publicSlug: "duplicate" });
    }).toThrow();
  });

  test("multiple games can share publicSlug=null", () => {
    const { id: ownerId } = insertTestUser(testDb.sqlite, { tier: "free" });
    insertGame({ id: "g1", userId: ownerId, publicSlug: null });
    expect(() => {
      insertGame({ id: "g2", userId: ownerId, publicSlug: null });
    }).not.toThrow();
  });
});

describe("recordRemix — lifetime cap interaction", () => {
  test("free user with budget: recordRemix succeeds and increments lifetime counter", async () => {
    const { recordRemix } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      lifetimeGenerationsUsed: 0,
    });
    insertGame({ id: "remix-target", userId, currentCode: "<html></html>" });

    const { logId } = await recordRemix(userId, "remix-target");
    expect(logId).toBeTruthy();

    const user = testDb.sqlite
      .query<{ lifetime_generations_used: number }, [string]>(
        `SELECT lifetime_generations_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.lifetime_generations_used).toBe(1);

    const log = testDb.sqlite
      .query<{ credits_charged: number; lifetime_counter_incremented: number }, [string]>(
        "SELECT credits_charged, lifetime_counter_incremented FROM usage_log WHERE id = ?"
      )
      .get(logId);
    expect(log?.credits_charged).toBe(0);
    expect(log?.lifetime_counter_incremented).toBe(1);
  });

  test("free user at lifetime cap: recordRemix throws with kind=lifetime", async () => {
    const { recordRemix, InsufficientCreditsError } = await import(
      "../src/services/usage/charge.js"
    );
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      lifetimeGenerationsUsed: 1, // == cap
    });
    insertGame({ id: "remix-target", userId });

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
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "creator",
      lifetimeGenerationsUsed: 100, // way over cap; doesn't matter for paid
    });
    insertGame({ id: "remix-target", userId });

    const { logId } = await recordRemix(userId, "remix-target");
    expect(logId).toBeTruthy();

    const user = testDb.sqlite
      .query<{ lifetime_generations_used: number }, [string]>(
        `SELECT lifetime_generations_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.lifetime_generations_used).toBe(100); // unchanged
  });

  test("admin: recordRemix succeeds and inserts a log row with no counter changes", async () => {
    const { recordRemix } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, { tier: "admin" });
    insertGame({ id: "remix-target", userId });

    const { logId } = await recordRemix(userId, "remix-target");
    expect(logId).toBeTruthy();

    const log = testDb.sqlite
      .query<{ credits_charged: number; lifetime_counter_incremented: number }, [string]>(
        "SELECT credits_charged, lifetime_counter_incremented FROM usage_log WHERE id = ?"
      )
      .get(logId);
    expect(log?.credits_charged).toBe(0);
    expect(log?.lifetime_counter_incremented).toBe(0);
  });
});
