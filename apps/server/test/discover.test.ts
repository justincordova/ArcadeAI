// Tests for the discover service: listing semantics (sort modes, genre
// filter, public-only) and the like / unlike contract (idempotency,
// counter sync).

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
  publishedAt?: number;
  genre?: string;
  likeCount?: number;
  playCount?: number;
}

function insertGame(args: InsertGameArgs): string {
  const id = args.id ?? randomUUID();
  const now = Date.now();
  testDb.sqlite
    .prepare(
      `INSERT INTO games (
        id, user_id, title, current_code, thumbnail, genre,
        original_prompt, is_public, public_slug, published_at,
        remixed_from_game_id, play_count, like_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, 'p', ?, ?, ?, NULL, ?, ?, ?, ?)`
    )
    .run(
      id,
      args.userId,
      `t-${id.slice(0, 6)}`,
      "<html>",
      args.genre ?? null,
      args.isPublic ? 1 : 0,
      args.publicSlug ?? null,
      args.publishedAt ?? null,
      args.playCount ?? 0,
      args.likeCount ?? 0,
      now,
      now
    );
  return id;
}

describe("listDiscoverGames", () => {
  test("returns only public games", async () => {
    const { id: u } = insertTestUser(testDb.sqlite);
    const pubId = insertGame({
      userId: u,
      isPublic: true,
      publicSlug: "abc12345",
      publishedAt: Date.now(),
    });
    insertGame({ userId: u, isPublic: false, publicSlug: null });

    const { listDiscoverGames } = await import("../src/services/discover/list.js");
    const items = await listDiscoverGames({ sort: "new", limit: 10, offset: 0 });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(pubId);
  });

  test("excludes public games with a null slug so pagination counts stay correct", async () => {
    const { id: u } = insertTestUser(testDb.sqlite);
    const withSlug = insertGame({
      userId: u,
      isPublic: true,
      publicSlug: "hasslug1",
      publishedAt: Date.now(),
    });
    // Public but no slug (e.g. a remix copy) — must be filtered in SQL, not
    // post-fetch, so a full DB page isn't shrunk below `limit` and the route
    // doesn't stop paginating early.
    insertGame({ userId: u, isPublic: true, publicSlug: null, publishedAt: Date.now() });

    const { listDiscoverGames } = await import("../src/services/discover/list.js");
    const items = await listDiscoverGames({ sort: "new", limit: 10, offset: 0 });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(withSlug);
  });

  test("'top' sorts by likeCount desc", async () => {
    const { id: u } = insertTestUser(testDb.sqlite);
    const lo = insertGame({
      userId: u,
      isPublic: true,
      publicSlug: "lo000001",
      publishedAt: Date.now(),
      likeCount: 1,
    });
    const hi = insertGame({
      userId: u,
      isPublic: true,
      publicSlug: "hi000001",
      publishedAt: Date.now(),
      likeCount: 99,
    });

    const { listDiscoverGames } = await import("../src/services/discover/list.js");
    const items = await listDiscoverGames({ sort: "top", limit: 10, offset: 0 });

    expect(items.map((i) => i.id)).toEqual([hi, lo]);
  });

  test("'new' sorts by publishedAt desc", async () => {
    const { id: u } = insertTestUser(testDb.sqlite);
    const older = insertGame({
      userId: u,
      isPublic: true,
      publicSlug: "old00001",
      publishedAt: 1000,
    });
    const newer = insertGame({
      userId: u,
      isPublic: true,
      publicSlug: "new00001",
      publishedAt: 9000,
    });

    const { listDiscoverGames } = await import("../src/services/discover/list.js");
    const items = await listDiscoverGames({ sort: "new", limit: 10, offset: 0 });

    expect(items.map((i) => i.id)).toEqual([newer, older]);
  });

  test("genre filter narrows results", async () => {
    const { id: u } = insertTestUser(testDb.sqlite);
    const snake = insertGame({
      userId: u,
      isPublic: true,
      publicSlug: "snake001",
      publishedAt: Date.now(),
      genre: "snake",
    });
    insertGame({
      userId: u,
      isPublic: true,
      publicSlug: "puzzle01",
      publishedAt: Date.now(),
      genre: "puzzle",
    });

    const { listDiscoverGames } = await import("../src/services/discover/list.js");
    const items = await listDiscoverGames({
      sort: "new",
      genre: "snake",
      limit: 10,
      offset: 0,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(snake);
  });

  test("hydrates `liked` for the viewer when given a userId", async () => {
    const { id: owner } = insertTestUser(testDb.sqlite, { email: "o@t" });
    const { id: viewer } = insertTestUser(testDb.sqlite, { email: "v@t" });
    const liked = insertGame({
      userId: owner,
      isPublic: true,
      publicSlug: "liked001",
      publishedAt: Date.now(),
    });
    const unliked = insertGame({
      userId: owner,
      isPublic: true,
      publicSlug: "noliket1",
      publishedAt: Date.now(),
    });

    testDb.sqlite
      .prepare("INSERT INTO game_likes (game_id, user_id, created_at) VALUES (?, ?, ?)")
      .run(liked, viewer, Date.now());

    const { listDiscoverGames } = await import("../src/services/discover/list.js");
    const items = await listDiscoverGames({
      sort: "new",
      limit: 10,
      offset: 0,
      viewerUserId: viewer,
    });

    const map = new Map(items.map((i) => [i.id, i.liked]));
    expect(map.get(liked)).toBe(true);
    expect(map.get(unliked)).toBe(false);
  });
});

describe("likeGame / unlikeGame", () => {
  test("like increments counter; second like is idempotent", async () => {
    const { id: owner } = insertTestUser(testDb.sqlite, { email: "o@t" });
    const { id: viewer } = insertTestUser(testDb.sqlite, { email: "v@t" });
    const gameId = insertGame({
      userId: owner,
      isPublic: true,
      publicSlug: "ldbl0001",
      publishedAt: Date.now(),
    });

    const { likeGame } = await import("../src/services/discover/likes.js");
    const first = await likeGame(gameId, viewer);
    const second = await likeGame(gameId, viewer);

    expect(first?.liked).toBe(true);
    expect(first?.changed).toBe(true);
    expect(first?.likeCount).toBe(1);

    expect(second?.liked).toBe(true);
    expect(second?.changed).toBe(false);
    expect(second?.likeCount).toBe(1);

    // Counter on games row should reflect 1
    const row = testDb.sqlite.prepare("SELECT like_count FROM games WHERE id = ?").get(gameId) as {
      like_count: number;
    };
    expect(row.like_count).toBe(1);
  });

  test("unlike decrements counter; unliking when not liked is idempotent", async () => {
    const { id: owner } = insertTestUser(testDb.sqlite, { email: "o@t" });
    const { id: viewer } = insertTestUser(testDb.sqlite, { email: "v@t" });
    const gameId = insertGame({
      userId: owner,
      isPublic: true,
      publicSlug: "ulbl0001",
      publishedAt: Date.now(),
      likeCount: 5,
    });

    const { likeGame, unlikeGame } = await import("../src/services/discover/likes.js");

    // Bootstrap: owner already has 5 likes from elsewhere; viewer adds one
    await likeGame(gameId, viewer);

    const first = await unlikeGame(gameId, viewer);
    const second = await unlikeGame(gameId, viewer);

    expect(first?.liked).toBe(false);
    expect(first?.changed).toBe(true);
    expect(first?.likeCount).toBe(5);

    expect(second?.changed).toBe(false);
    expect(second?.likeCount).toBe(5);
  });

  test("liking a private game returns null", async () => {
    const { id: owner } = insertTestUser(testDb.sqlite, { email: "o@t" });
    const { id: viewer } = insertTestUser(testDb.sqlite, { email: "v@t" });
    const gameId = insertGame({ userId: owner, isPublic: false });

    const { likeGame } = await import("../src/services/discover/likes.js");
    const result = await likeGame(gameId, viewer);
    expect(result).toBeNull();
  });
});

describe("recordPlay", () => {
  test("increments playCount on a public game", async () => {
    const { id: owner } = insertTestUser(testDb.sqlite);
    const gameId = insertGame({
      userId: owner,
      isPublic: true,
      publicSlug: "play0001",
      publishedAt: Date.now(),
    });

    const { recordPlay } = await import("../src/services/discover/likes.js");
    await recordPlay(gameId);
    await recordPlay(gameId);

    const row = testDb.sqlite.prepare("SELECT play_count FROM games WHERE id = ?").get(gameId) as {
      play_count: number;
    };
    expect(row.play_count).toBe(2);
  });

  test("does not increment a private game's playCount", async () => {
    const { id: owner } = insertTestUser(testDb.sqlite);
    const gameId = insertGame({ userId: owner, isPublic: false });

    const { recordPlay } = await import("../src/services/discover/likes.js");
    await recordPlay(gameId);

    const row = testDb.sqlite.prepare("SELECT play_count FROM games WHERE id = ?").get(gameId) as {
      play_count: number;
    };
    expect(row.play_count).toBe(0);
  });
});
