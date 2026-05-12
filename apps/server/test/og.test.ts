// Tests for /api/og/:slug.png — the OG/unfurl image route.
//
// Validates: known-public game with a valid data:image/png thumbnail
// returns the decoded bytes; missing thumbnail or unknown slug returns
// the fallback PNG (never 404, so unfurls don't break); invalid
// data-URL prefixes fall back gracefully.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { type TestDb, createTestDb, insertTestUser } from "./test-db.js";

let testDb: TestDb;
let app: FastifyInstance;

async function buildApp() {
  const fastify = Fastify({ logger: false });
  const { ogRoutes } = await import("../src/routes/og.js");
  await fastify.register(ogRoutes);
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

interface InsertGameArgs {
  userId: string;
  publicSlug: string;
  isPublic?: boolean;
  thumbnail?: string | null;
}

function insertGame(args: InsertGameArgs): string {
  const id = randomUUID();
  const now = Date.now();
  testDb.sqlite
    .prepare(
      `INSERT INTO games (
        id, user_id, title, current_code, thumbnail, genre,
        original_prompt, is_public, public_slug, published_at,
        remixed_from_game_id, play_count, like_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 'p', ?, ?, ?, NULL, 0, 0, ?, ?)`
    )
    .run(
      id,
      args.userId,
      "test",
      "<html>",
      args.thumbnail ?? null,
      args.isPublic === false ? 0 : 1,
      args.publicSlug,
      now,
      now,
      now
    );
  return id;
}

// 1x1 red PNG
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

describe("GET /api/og/:slug.png", () => {
  test("returns decoded PNG bytes for a public game with thumbnail", async () => {
    const { id } = insertTestUser(testDb.sqlite);
    insertGame({ userId: id, publicSlug: "abcdef12", thumbnail: TINY_PNG_DATA_URL });

    const res = await app.inject({ method: "GET", url: "/api/og/abcdef12.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toContain("public");
    // Body should be the decoded PNG bytes (signature: 89 50 4e 47)
    const buf = res.rawPayload;
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  test("returns fallback PNG when game has no thumbnail", async () => {
    const { id } = insertTestUser(testDb.sqlite);
    insertGame({ userId: id, publicSlug: "0badcafe", thumbnail: null });

    const res = await app.inject({ method: "GET", url: "/api/og/0badcafe.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  test("returns fallback PNG (not 404) for unknown slug", async () => {
    const res = await app.inject({ method: "GET", url: "/api/og/deadbeef.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  test("falls back when thumbnail data URL is malformed", async () => {
    const { id } = insertTestUser(testDb.sqlite);
    insertGame({
      userId: id,
      publicSlug: "b0bacafe",
      thumbnail: "not-a-valid-data-url",
    });

    const res = await app.inject({ method: "GET", url: "/api/og/b0bacafe.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  test("400s on a malformed slug rather than running a DB lookup", async () => {
    const res = await app.inject({ method: "GET", url: "/api/og/nothex!1.png" });
    expect(res.statusCode).toBe(400);
  });

  test("does not serve thumbnails for private games (treated as not found)", async () => {
    const { id } = insertTestUser(testDb.sqlite);
    insertGame({
      userId: id,
      publicSlug: "0ff11ce0",
      isPublic: false,
      thumbnail: TINY_PNG_DATA_URL,
    });

    const res = await app.inject({ method: "GET", url: "/api/og/0ff11ce0.png" });
    // Returns the fallback (200) rather than the actual thumbnail
    expect(res.statusCode).toBe(200);
    // Fallback bytes are static; they won't equal the per-game thumbnail
    const expectedThumb = Buffer.from(TINY_PNG_DATA_URL.split(",")[1] ?? "", "base64");
    expect(Buffer.compare(res.rawPayload as Buffer, expectedThumb)).not.toBe(0);
  });
});
