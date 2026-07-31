// Integration tests for the read/mutation games routes via app.inject().
// We mock the DB module and inject a stub auth session through a preHandler
// hook so the real route handlers run end-to-end without needing Better
// Auth or a real session cookie.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { createTestDb, insertTestUser, type TestDb } from "./test-db.js";

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

// Minimal stand-in for the AI SDK's streamText result. The repair-budget test
// deliberately lets a request through the 429 guard, which starts a real
// stream. Without this stub that reached api.anthropic.com on every run: CI
// depended on Anthropic being up, a Cloudflare request id landed in public
// logs, and adding ANTHROPIC_API_KEY to the CI environment would have turned
// those into billable generations against the fixtures.
function fakeStream(chunks: string[] = ["<!DOCTYPE html><html></html>"]) {
  return {
    textStream: (async function* () {
      for (const c of chunks) yield c;
    })(),
    finishReason: Promise.resolve("stop" as const),
    usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
  };
}

beforeEach(async () => {
  testDb = createTestDb();
  mock.module("../src/lib/db.ts", () => ({
    db: testDb.db,
    sqlite: testDb.sqlite,
  }));
  // Override only the three stream entry points. The module's other exports
  // (withTimeout, AUX_LLM_TIMEOUT_MS, isLlmAuthError, LLM_TIMEOUT_MS) are
  // imported by the aux LLM modules and must survive the mock.
  const realLlmClient = await import("../src/services/llm/client.js");
  mock.module("../src/services/llm/client.ts", () => ({
    ...realLlmClient,
    streamGame: async () => fakeStream(),
    streamRefinement: async () => fakeStream(),
    streamRepair: async () => fakeStream(),
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

  test("omits the heavy previousCode and thumbnail columns", async () => {
    // Both are full-size blobs (a whole HTML document, and a base64 data URL up
    // to 350 KB) that no client reads off this response. It is fetched on every
    // dashboard card hover and twice per refinement turn, so shipping them is
    // pure waste. canUndo carries the only bit the client needs.
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, thumbnail: TINY_PNG_DATA_URL });
    testDb.sqlite
      .prepare("UPDATE games SET previous_code = ? WHERE id = ?")
      .run("<html>old</html>", gameId);

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("thumbnail");
    expect(body).not.toHaveProperty("previousCode");
    expect(body.canUndo).toBe(true);
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

  test("inProgress is true for a live generation row, false once it goes stale", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId });

    // Live in-flight generation: succeeded=0, not refunded, recent.
    testDb.sqlite
      .query(
        `INSERT INTO usage_log
           (id, user_id, game_id, action, credits_charged, succeeded, created_at)
         VALUES (?, ?, ?, 'generation', 2, 0, ?)`
      )
      .run("live-gen-log", userId, gameId, Date.now());

    const live = await app.inject({ method: "GET", url: `/api/games/${gameId}` });
    expect((live.json() as { inProgress: boolean }).inProgress).toBe(true);

    // Age the row past STALE_STREAM_CUTOFF_MS (15 min) — simulates a hard
    // crash that skipped finalization. The game must stop reporting
    // "generating" forever.
    testDb.sqlite
      .query("UPDATE usage_log SET created_at = ? WHERE id = ?")
      .run(Date.now() - 16 * 60_000, "live-gen-log");

    const stale = await app.inject({ method: "GET", url: `/api/games/${gameId}` });
    expect((stale.json() as { inProgress: boolean }).inProgress).toBe(false);
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

describe("POST /api/games/:id/undo", () => {
  function setPreviousCode(gameId: string, previous: string | null) {
    testDb.sqlite.query("UPDATE games SET previous_code = ? WHERE id = ?").run(previous, gameId);
  }

  function readCodes(gameId: string) {
    return testDb.sqlite
      .query<{ current_code: string; previous_code: string | null }, [string]>(
        "SELECT current_code, previous_code FROM games WHERE id = ?"
      )
      .get(gameId);
  }

  test("restores previous_code into current_code and clears the slot", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>refined</html>" });
    setPreviousCode(gameId, "<html>original</html>");

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/undo`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { currentCode: string; canUndo: boolean };
    expect(body.currentCode).toBe("<html>original</html>");
    expect(body.canUndo).toBe(false);

    const row = readCodes(gameId);
    expect(row?.current_code).toBe("<html>original</html>");
    expect(row?.previous_code).toBeNull();
  });

  test("returns 409 when there is nothing to undo", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>only</html>" });
    // previous_code defaults to NULL — never refined.

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/undo`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe("CONFLICT");
    // current_code must be untouched.
    expect(readCodes(gameId)?.current_code).toBe("<html>only</html>");
  });

  test("a second undo is a no-op (single-level, no redo)", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>refined</html>" });
    setPreviousCode(gameId, "<html>original</html>");

    const first = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/undo`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/undo`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    // Still the restored original — a second undo cannot resurrect the refined code.
    expect(readCodes(gameId)?.current_code).toBe("<html>original</html>");
  });

  test("returns 409 while a stream is in flight for the game", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>refined</html>" });
    setPreviousCode(gameId, "<html>original</html>");

    // Simulate an in-flight refinement: charged (succeeded=0) and not
    // refunded. Under background-stream semantics this row exists for the
    // whole life of the stream, even after the client disconnects.
    testDb.sqlite
      .query(
        `INSERT INTO usage_log
           (id, user_id, game_id, action, credits_charged, succeeded, created_at)
         VALUES (?, ?, ?, 'refinement', 2, 0, ?)`
      )
      .run("inflight-log", userId, gameId, Date.now());

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/undo`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe("CONFLICT");
    // Nothing swapped — the stream's eventual persistence won't clobber an
    // undo because the undo never happened.
    const row = readCodes(gameId);
    expect(row?.current_code).toBe("<html>refined</html>");
    expect(row?.previous_code).toBe("<html>original</html>");
  });

  test("undo succeeds when the only in-flight row is stale (crash-orphaned)", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>refined</html>" });
    setPreviousCode(gameId, "<html>original</html>");

    // A row left succeeded=0 / refunded_at NULL by a hard crash (no
    // finalization ever ran). The STALE_STREAM_CUTOFF_MS predicate must
    // treat it as dead — without the cutoff this row would 409 every undo
    // for this game forever. 16 minutes > the 15-minute cutoff.
    testDb.sqlite
      .query(
        `INSERT INTO usage_log
           (id, user_id, game_id, action, credits_charged, succeeded, created_at)
         VALUES (?, ?, ?, 'refinement', 2, 0, ?)`
      )
      .run("stale-log", userId, gameId, Date.now() - 16 * 60_000);

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/undo`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(readCodes(gameId)?.current_code).toBe("<html>original</html>");
  });

  test("undo succeeds once the in-flight stream has settled (refunded)", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>refined</html>" });
    setPreviousCode(gameId, "<html>original</html>");

    // A failed-and-refunded stream is no longer in flight.
    testDb.sqlite
      .query(
        `INSERT INTO usage_log
           (id, user_id, game_id, action, credits_charged, succeeded, refunded_at, created_at)
         VALUES (?, ?, ?, 'refinement', 2, 0, ?, ?)`
      )
      .run("settled-log", userId, gameId, Date.now(), Date.now());

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/undo`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(readCodes(gameId)?.current_code).toBe("<html>original</html>");
  });

  test("404 when the game is not owned by the caller", async () => {
    const { id: ownerId } = insertTestUser(testDb.sqlite);
    const gameId = insertGame({ userId: ownerId, currentCode: "<html>refined</html>" });
    setPreviousCode(gameId, "<html>original</html>");

    // Caller is a different user.
    stubUserId = "someone-else";
    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/undo`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    // The owner's game must be untouched.
    expect(readCodes(gameId)?.current_code).toBe("<html>refined</html>");
    expect(readCodes(gameId)?.previous_code).toBe("<html>original</html>");
  });
});

describe("POST /api/games/:id/repair — daily budget", () => {
  test("returns 429 RATE_LIMITED once 50 repairs have run in the last 24h", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>broken</html>" });

    // Seed 50 repair attempts inside the rolling window. Repairs are
    // credit-free and exempt from lifetime caps, so this budget is the ONLY
    // cost control on the endpoint — the check must fire before the SSE
    // hijack so the client gets a proper JSON 429.
    const insert = testDb.sqlite.prepare(
      `INSERT INTO usage_log
         (id, user_id, game_id, action, credits_charged, succeeded, created_at)
       VALUES (?, ?, ?, 'repair', 0, 1, ?)`
    );
    for (let i = 0; i < 50; i++) {
      insert.run(`repair-log-${i}`, userId, gameId, Date.now() - i * 1000);
    }

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/repair`,
      headers: { "content-type": "application/json" },
      payload: { error: { message: "TypeError: x is undefined" } },
    });

    expect(res.statusCode).toBe(429);
    expect((res.json() as { code: string }).code).toBe("RATE_LIMITED");
  });

  test("repairs older than 24h do not count against the budget", async () => {
    const { id: userId } = insertTestUser(testDb.sqlite);
    stubUserId = userId;
    const gameId = insertGame({ userId, currentCode: "<html>broken</html>" });

    // 50 attempts, all aged past the rolling window — the budget check must
    // ignore them. The request then proceeds past the 429 guard into a
    // hijacked SSE response driven by the stubbed LLM client, so all this
    // test asserts is that the budget did not reject it (statusCode !== 429).
    const insert = testDb.sqlite.prepare(
      `INSERT INTO usage_log
         (id, user_id, game_id, action, credits_charged, succeeded, created_at)
       VALUES (?, ?, ?, 'repair', 0, 1, ?)`
    );
    const old = Date.now() - 25 * 3600_000;
    for (let i = 0; i < 50; i++) {
      insert.run(`old-repair-log-${i}`, userId, gameId, old - i * 1000);
    }

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/repair`,
      headers: { "content-type": "application/json" },
      payload: { error: { message: "TypeError: x is undefined" } },
    });

    expect(res.statusCode).not.toBe(429);
  });
});
