// Unit tests for lib/ownership — owner check, public-game read path.

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

interface InsertGameArgs {
  id?: string;
  userId: string;
  isPublic?: boolean;
  publicSlug?: string | null;
  title?: string;
}

function insertGame(args: InsertGameArgs): string {
  const id = args.id ?? randomUUID();
  const now = Date.now();
  testDb.sqlite
    .prepare(
      `INSERT INTO games (
        id, user_id, title, current_code, thumbnail, genre,
        original_prompt, is_public, public_slug, published_at,
        remixed_from_game_id, created_at, updated_at
      ) VALUES (?, ?, ?, '<html>', NULL, NULL, 'prompt', ?, ?, NULL, NULL, ?, ?)`
    )
    .run(
      id,
      args.userId,
      args.title ?? "Test Game",
      args.isPublic ? 1 : 0,
      args.publicSlug ?? null,
      now,
      now
    );
  return id;
}

describe("loadOwnedGame", () => {
  test("returns the game for its owner", async () => {
    const { loadOwnedGame } = await import("../src/lib/ownership.js");
    const { id: userId } = insertTestUser(testDb.sqlite);
    const gameId = insertGame({ userId });

    const game = await loadOwnedGame(gameId, userId);
    expect(game).toBeTruthy();
    expect(game?.id).toBe(gameId);
  });

  test("returns null for a non-owner (the 404 case in route handlers)", async () => {
    const { loadOwnedGame } = await import("../src/lib/ownership.js");
    const { id: ownerId } = insertTestUser(testDb.sqlite, { email: "owner@test" });
    const { id: otherId } = insertTestUser(testDb.sqlite, { email: "other@test" });
    const gameId = insertGame({ userId: ownerId });

    const game = await loadOwnedGame(gameId, otherId);
    expect(game).toBeNull();
  });

  test("returns null for a missing game id", async () => {
    const { loadOwnedGame } = await import("../src/lib/ownership.js");
    const { id: userId } = insertTestUser(testDb.sqlite);

    const game = await loadOwnedGame("does-not-exist", userId);
    expect(game).toBeNull();
  });
});

describe("loadPublicGame", () => {
  test("returns a payload with ownerDisplayName for a published game", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    const { id: userId } = insertTestUser(testDb.sqlite);
    insertGame({ userId, isPublic: true, publicSlug: "abc12345", title: "Public" });

    const game = await loadPublicGame("abc12345");
    expect(game).toBeTruthy();
    expect(game?.title).toBe("Public");
    expect(game?.ownerDisplayName).toBe(`display-${userId}`);
  });

  test("returns null for a private game (existence-leakage guard)", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    const { id: userId } = insertTestUser(testDb.sqlite);
    insertGame({ userId, isPublic: false, publicSlug: "private1" });

    expect(await loadPublicGame("private1")).toBeNull();
  });

  test("returns null for an unknown slug", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    expect(await loadPublicGame("nonexistent")).toBeNull();
  });

  test("does NOT expose userId in the payload", async () => {
    const { loadPublicGame } = await import("../src/lib/ownership.js");
    const { id: userId } = insertTestUser(testDb.sqlite);
    insertGame({ userId, isPublic: true, publicSlug: "leak-test" });

    const game = await loadPublicGame("leak-test");
    expect(game).toBeTruthy();
    expect(game).not.toHaveProperty("userId");
  });
});
