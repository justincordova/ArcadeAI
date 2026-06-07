// Integration tests for the read/mutation games routes via app.inject().
// We mock the DB module and inject a stub auth session through a preHandler
// hook so the real route handlers run end-to-end without needing Better
// Auth or a real session cookie.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { type TestDb, createTestDb, insertTestUser } from "./test-db.js";

let testDb: TestDb;
let app: FastifyInstance;
let stubUserId = "user-stub";

async function buildApp() {
  const fastify = Fastify({ logger: false });

  // Stub auth — every request gets `request.authSession.user.id` so the real
  // route handlers can read it. Routes that exempt themselves from auth
  // (health, config, /api/play/*) aren't under test here.
  fastify.addHook("preHandler", async (request) => {
    (request as unknown as { authSession: { user: { id: string } } }).authSession = {
      user: { id: stubUserId },
    };
  });

  // The games route ships rate-limit config tied to fastify-rate-limit's
  // shape. Without registering the plugin, route() throws during
  // gameRoutes() execution. Register a minimal stub.
  await fastify.register(import("@fastify/rate-limit"), {
    global: false,
    max: 1000,
    timeWindow: "1 minute",
  });

  const { gamesRoutes } = await import("../src/routes/games.js");
  await fastify.register(gamesRoutes);
  return fastify;
}

beforeEach(async () => {
  testDb = createTestDb();
  mock.module("../src/lib/db.ts", () => ({
    db: testDb.db,
    sqlite: testDb.sqlite,
  }));
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  testDb.close();
});

function insertGame(args: {
  id?: string;
  userId: string;
  title?: string;
  currentCode?: string;
  thumbnail?: string | null;
}): string {
  const id = args.id ?? randomUUID();
  const now = Date.now();
  testDb.sqlite
    .prepare(
      `INSERT INTO games (
        id, user_id, title, current_code, thumbnail, genre,
        original_prompt, is_public, public_slug, published_at,
        remixed_from_game_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 'p', 0, NULL, NULL, NULL, ?, ?)`
    )
    .run(
      id,
      args.userId,
      args.title ?? "test",
      args.currentCode ?? "<html>",
      args.thumbnail ?? null,
      now,
      now
    );
  return id;
}

// 1x1 red PNG as a data URL — a valid thumbnail for serve tests.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

describe("GET /api/games/:id", () => {
  test("returns the game + messages for the owner", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, title: "Mine" });

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; title: string; messages: unknown[] };
    expect(body.id).toBe(gameId);
    expect(body.title).toBe("Mine");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  test("returns 404 when caller is not the owner (no leakage of existence)", async () => {
    const { id: ownerId } = insertTestUser(testDb.sqlite, { email: "owner@test" });
    const { id: otherId } = insertTestUser(testDb.sqlite, { email: "other@test" });
    stubUserId = otherId;
    const gameId = insertGame({ userId: ownerId });

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}` });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { code: string; message: string };
    expect(body.code).toBe("NOT_FOUND");
  });

  test("returns 404 for a missing game id", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;

    const res = await app.inject({ method: "GET", url: "/api/games/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /api/games/:id", () => {
  test("renames the game when the body is valid", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, title: "old" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/games/${gameId}`,
      payload: { title: "new" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { title: string };
    expect(body.title).toBe("new");

    const row = testDb.sqlite
      .query<{ title: string }, [string]>("SELECT title FROM games WHERE id = ?")
      .get(gameId);
    expect(row?.title).toBe("new");
  });

  test("returns 400 with VALIDATION_ERROR for an empty title", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/games/${gameId}`,
      payload: { title: "" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  test("returns 404 for a non-owner", async () => {
    const { id: ownerId } = insertTestUser(testDb.sqlite, { email: "o@t" });
    const { id: otherId } = insertTestUser(testDb.sqlite, { email: "p@t" });
    stubUserId = otherId;
    const gameId = insertGame({ userId: ownerId });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/games/${gameId}`,
      payload: { title: "stolen" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/games/:id", () => {
  test("deletes the game and cascades messages (FK ON DELETE CASCADE)", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId });

    // Seed a message so we can verify cascade
    testDb.sqlite
      .prepare(
        `INSERT INTO messages (id, game_id, kind, content, created_at) VALUES (?, ?, 'prompt', 'p', ?)`
      )
      .run("m-1", gameId, Date.now());

    const res = await app.inject({ method: "DELETE", url: `/api/games/${gameId}` });
    expect(res.statusCode).toBe(204);

    const game = testDb.sqlite
      .query<{ id: string }, [string]>("SELECT id FROM games WHERE id = ?")
      .get(gameId);
    expect(game).toBeNull();

    const msg = testDb.sqlite
      .query<{ id: string }, [string]>("SELECT id FROM messages WHERE game_id = ?")
      .get(gameId);
    expect(msg).toBeNull();
  });

  test("returns 404 for a non-owner; does not delete the row", async () => {
    const { id: ownerId } = insertTestUser(testDb.sqlite, { email: "o@t" });
    const { id: otherId } = insertTestUser(testDb.sqlite, { email: "p@t" });
    stubUserId = otherId;
    const gameId = insertGame({ userId: ownerId });

    const res = await app.inject({ method: "DELETE", url: `/api/games/${gameId}` });
    expect(res.statusCode).toBe(404);

    const row = testDb.sqlite
      .query<{ id: string }, [string]>("SELECT id FROM games WHERE id = ?")
      .get(gameId);
    expect(row?.id).toBe(gameId);
  });
});

describe("GET /api/games (list)", () => {
  test("returns only the caller's games, sorted by updated_at desc", async () => {
    const { id: meId } = insertTestUser(testDb.sqlite, { email: "me@t" });
    const { id: otherId } = insertTestUser(testDb.sqlite, { email: "x@t" });
    stubUserId = meId;
    insertGame({ userId: meId, title: "mine-1" });
    insertGame({ userId: meId, title: "mine-2" });
    insertGame({ userId: otherId, title: "theirs" });

    const res = await app.inject({ method: "GET", url: "/api/games" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ title: string }>;
    expect(body).toHaveLength(2);
    expect(body.every((g) => g.title.startsWith("mine"))).toBe(true);
  });

  test("returns hasThumbnail flag, not the inline thumbnail bytes", async () => {
    const { id: meId } = insertTestUser(testDb.sqlite);
    stubUserId = meId;
    insertGame({ userId: meId, title: "with-thumb", thumbnail: TINY_PNG_DATA_URL });
    insertGame({ userId: meId, title: "no-thumb", thumbnail: null });

    const res = await app.inject({ method: "GET", url: "/api/games" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ title: string; hasThumbnail?: boolean; thumbnail?: string }>;
    // The heavy base64 thumbnail must NOT be in the list payload.
    expect(body.every((g) => g.thumbnail === undefined)).toBe(true);
    const withThumb = body.find((g) => g.title === "with-thumb");
    const noThumb = body.find((g) => g.title === "no-thumb");
    expect(withThumb?.hasThumbnail).toBe(true);
    expect(noThumb?.hasThumbnail).toBe(false);
  });
});

describe("GET /api/games/:id/thumbnail.png", () => {
  test("serves the decoded PNG bytes for the owner", async () => {
    const { id: meId } = insertTestUser(testDb.sqlite);
    stubUserId = meId;
    const gameId = insertGame({ userId: meId, thumbnail: TINY_PNG_DATA_URL });

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}/thumbnail.png` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    // Per-user resource — must be privately cached so a shared cache can't
    // serve it cross-user.
    expect(String(res.headers["cache-control"])).toContain("private");
    // PNG signature 89 50 4e 47
    const buf = res.rawPayload;
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
  });

  test("serves a placeholder when the game has no thumbnail", async () => {
    const { id: meId } = insertTestUser(testDb.sqlite);
    stubUserId = meId;
    const gameId = insertGame({ userId: meId, thumbnail: null });

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}/thumbnail.png` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });

  test("404s for a game the caller does not own (no cross-user thumbnail access)", async () => {
    const { id: ownerId } = insertTestUser(testDb.sqlite, { email: "owner@t" });
    const { id: otherId } = insertTestUser(testDb.sqlite, { email: "other@t" });
    stubUserId = otherId;
    const gameId = insertGame({ userId: ownerId, thumbnail: TINY_PNG_DATA_URL });

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}/thumbnail.png` });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/games/:id/publish", () => {
  function readPublish(gameId: string) {
    return testDb.sqlite
      .query<
        { is_public: number; public_slug: string | null; published_at: number | null },
        [string]
      >("SELECT is_public, public_slug, published_at FROM games WHERE id = ?")
      .get(gameId);
  }

  test("first publish sets slug, is_public, and published_at together", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>game</html>" });

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/publish`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { slug: string; isPublic: boolean };
    expect(body.isPublic).toBe(true);
    expect(body.slug).toMatch(/^[0-9a-f]{8}$/);

    // The row must never be half-published: a slug without is_public is the
    // inconsistent state the single-UPDATE fix prevents.
    const row = readPublish(gameId);
    expect(row?.is_public).toBe(1);
    expect(row?.public_slug).toBe(body.slug);
    expect(row?.published_at).toBeGreaterThan(0);
  });

  test("re-publish reuses the existing slug", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>game</html>" });

    const first = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/publish`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    const firstSlug = (first.json() as { slug: string }).slug;

    await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/unpublish`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    const second = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/publish`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    const secondSlug = (second.json() as { slug: string }).slug;

    expect(secondSlug).toBe(firstSlug);
    expect(readPublish(gameId)?.is_public).toBe(1);
  });

  test("rejects publishing a game with no code", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "" });

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/publish`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
