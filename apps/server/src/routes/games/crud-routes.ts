// Non-streaming game routes: list, fetch, rename, delete, publish/unpublish,
// undo, and thumbnail read/write. These are plain request/response handlers
// (no `reply.hijack()`), so Fastify's global error handler applies normally.
// The SSE generate/refine/repair handlers live in streaming-routes.ts.
import { randomUUID } from "node:crypto";
import { games, messages, usageLog } from "@arcadeai/db";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db, sqlite } from "../../lib/db.js";
import { notFoundError, sendError, validationError } from "../../lib/errors.js";
import { loadOwnedGame } from "../../lib/ownership.js";
import { serveThumbnail } from "../../lib/serve-thumbnail.js";
import { PatchGameBody, parseGameId, STALE_STREAM_CUTOFF_MS, ThumbnailBody } from "./shared.js";

export function registerGameCrudRoutes(app: FastifyInstance) {
  // GET /api/games/:id — get game with messages
  //
  // `inProgress` is true while a generation for this game is still
  // running server-side. This lets the client poll for completion when
  // the user navigates away mid-generation and comes back — the page
  // shows a "Generating..." overlay until the row drops out of the
  // in-flight set, at which point current_code is populated.
  //
  // We only check `action = 'generation'` because refinement and repair
  // preserve existing currentCode (the game stays playable in its
  // previous state mid-stream — no need to suppress the iframe).
  app.get("/api/games/:id", async (request, reply) => {
    const id = parseGameId(request, reply);
    if (!id) return;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return sendError(reply, 404, notFoundError());
    }

    const [msgs, inflight] = await Promise.all([
      db.select().from(messages).where(eq(messages.gameId, id)).orderBy(asc(messages.createdAt)),
      db
        .select({ id: usageLog.id })
        .from(usageLog)
        .where(
          and(
            eq(usageLog.gameId, id),
            eq(usageLog.action, "generation"),
            eq(usageLog.succeeded, 0),
            isNull(usageLog.refundedAt),
            // Ignore rows orphaned by a crash — see STALE_STREAM_CUTOFF_MS.
            gt(usageLog.createdAt, Date.now() - STALE_STREAM_CUTOFF_MS)
          )
        )
        .limit(1),
    ]);

    // Strip previous_code from the response — it can be a full HTML document
    // and the client only needs to know whether an undo is available, not the
    // bytes themselves (undo restores them server-side). Expose that as the
    // boolean `canUndo` instead.
    //
    // Strip `thumbnail` for the same reason the list route excludes it: it is
    // a base64 data URL up to ~350 KB, GameDetail does not declare it, and no
    // client reads it — the builder loads it by reference from
    // GET /api/games/:id/thumbnail.png. This response is fetched on every
    // dashboard card hover (prefetch) and twice per refinement turn, so the
    // wasted bytes add up fast.
    const { previousCode, thumbnail, ...rest } = game;
    return reply.send({
      ...rest,
      canUndo: Boolean(previousCode),
      messages: msgs,
      inProgress: inflight.length > 0,
    });
  });

  // DELETE /api/games/:id
  app.delete("/api/games/:id", async (request, reply) => {
    const id = parseGameId(request, reply);
    if (!id) return;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return sendError(reply, 404, notFoundError());
    }

    await db.delete(games).where(eq(games.id, id));

    return reply.status(204).send();
  });

  // GET /api/games — list user's games for dashboard
  app.get("/api/games", async (request, reply) => {
    const userId = request.authSession.user.id;

    // NOTE: `thumbnail` (a base64 data URL up to ~350 KB each) is deliberately
    // NOT selected here. Returning every game's thumbnail inline made this
    // unpaginated response balloon to tens of MB for an active library, on
    // every dashboard load. The client loads thumbnails lazily by reference
    // from GET /api/games/:id/thumbnail.png instead. `hasThumbnail` tells the
    // client whether to render the <img> or a placeholder without shipping the
    // bytes.
    const rows = await db
      .select({
        id: games.id,
        title: games.title,
        // Computed in SQL — selecting the thumbnail column pulls up to
        // ~350 KB per row out of SQLite just to derive a boolean.
        hasThumbnail: sql<number>`${games.thumbnail} IS NOT NULL`,
        updatedAt: games.updatedAt,
        createdAt: games.createdAt,
        isPublic: games.isPublic,
        publicSlug: games.publicSlug,
        genre: games.genre,
      })
      .from(games)
      .where(eq(games.userId, userId))
      .orderBy(desc(games.updatedAt));

    const summaries = rows.map((row) => ({
      ...row,
      hasThumbnail: Boolean(row.hasThumbnail),
    }));

    return reply.send(summaries);
  });

  // GET /api/games/:id/thumbnail.png — owner-scoped thumbnail bytes.
  // Loaded lazily by the dashboard <img> so the list payload stays small.
  // Auth guard covers /api/games/*; the <img> sends the session cookie
  // same-origin. Decodes the stored data URL and serves real image bytes
  // (or a placeholder), cacheable so repeat dashboard visits don't refetch.
  app.get("/api/games/:id/thumbnail.png", async (request, reply) => {
    const id = parseGameId(request, reply);
    if (!id) return;
    const userId = request.authSession.user.id;

    const rows = await db
      .select({ thumbnail: games.thumbnail })
      .from(games)
      .where(and(eq(games.id, id), eq(games.userId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row) return sendError(reply, 404, notFoundError());

    // "private" — this is a per-user, cookie-authed resource. A shared cache
    // keyed only on the URL must not serve one user's thumbnail to another.
    serveThumbnail(reply, row.thumbnail, "private");
  });

  // PATCH /api/games/:id — rename game
  app.patch("/api/games/:id", async (request, reply) => {
    const id = parseGameId(request, reply);
    if (!id) return;

    const bodyResult = PatchGameBody.safeParse(request.body);
    if (!bodyResult.success) {
      return sendError(
        reply,
        400,
        validationError("Validation error", { issues: bodyResult.error.issues })
      );
    }

    const { title } = bodyResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return sendError(reply, 404, notFoundError());
    }

    const now = Date.now();
    await db.update(games).set({ title, updatedAt: now }).where(eq(games.id, id));

    return reply.send({ id, title, updatedAt: now });
  });

  // POST /api/games/:id/publish — make the game publicly playable. Generates
  // a public_slug on first publish and reuses it on subsequent publishes so
  // the URL is stable across publish/unpublish cycles.
  app.post("/api/games/:id/publish", async (request, reply) => {
    const id = parseGameId(request, reply);
    if (!id) return;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) return sendError(reply, 404, notFoundError());
    if (!game.currentCode) {
      return sendError(reply, 400, validationError("Game has no code to publish"));
    }

    const now = Date.now();
    let slug = game.publicSlug;

    if (slug) {
      // Slug already exists from a prior publish cycle — a single UPDATE flips
      // visibility atomically.
      await db
        .update(games)
        .set({ isPublic: true, publishedAt: now, updatedAt: now })
        .where(eq(games.id, id));
    } else {
      // First publish: assign the slug AND flip visibility in ONE UPDATE per
      // attempt. Splitting these into two writes (slug, then is_public) is not
      // atomic — a crash between them would persist a slug with is_public=false,
      // stranding the row half-published. A single statement is atomic, so the
      // row only ever transitions straight to fully-published.
      //
      // 8 hex chars = 4 billion options; collisions are vanishingly rare but
      // the unique index rejects duplicates, so we retry up to 3 times. ONLY
      // swallow UNIQUE collisions — masking other DB errors (timeout, schema
      // mismatch, disk full) as "retrying for collision" hides real failures.
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = randomUUID().replace(/-/g, "").slice(0, 8);
        try {
          await db
            .update(games)
            .set({ publicSlug: candidate, isPublic: true, publishedAt: now, updatedAt: now })
            .where(eq(games.id, id));
          slug = candidate;
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          // bun:sqlite surfaces unique-index violations as
          // "UNIQUE constraint failed: ..." or with SQLITE_CONSTRAINT.
          // Anything else is non-retryable.
          if (!/UNIQUE|SQLITE_CONSTRAINT/i.test(msg)) {
            throw err;
          }
        }
      }
      if (!slug) {
        request.log.error(
          { err: lastErr instanceof Error ? lastErr.message : String(lastErr) },
          "exhausted slug-collision retries"
        );
        return sendError(reply, 500, {
          code: "INTERNAL_ERROR",
          message: "Could not generate public slug; please retry",
        });
      }
    }

    return reply.send({ slug, isPublic: true, publishedAt: now });
  });

  // POST /api/games/:id/unpublish — keep the slug for stable re-publish, but
  // hide the game from /play/:slug.
  app.post("/api/games/:id/unpublish", async (request, reply) => {
    const id = parseGameId(request, reply);
    if (!id) return;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) return sendError(reply, 404, notFoundError());

    await db.update(games).set({ isPublic: false, updatedAt: Date.now() }).where(eq(games.id, id));

    return reply.send({ isPublic: false });
  });

  // POST /api/games/:id/undo — single-level undo of the last refinement/repair.
  // Restores previous_code into current_code and clears previous_code, so undo
  // is one step deep by design (no redo, no stack). Idempotent-safe: a second
  // undo with nothing to restore returns 409 rather than corrupting state.
  app.post("/api/games/:id/undo", async (request, reply) => {
    const id = parseGameId(request, reply);
    if (!id) return;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) return sendError(reply, 404, notFoundError());

    // Reject while any stream for this game is in flight. A refinement/repair
    // loads current_code at request start and persists (previous_code,
    // current_code) at completion — under background-stream semantics it keeps
    // running even after the client disconnects, so an undo accepted mid-stream
    // would be silently overwritten when the stream lands. Same in-flight
    // predicate as GET /api/games/:id's `inProgress`.
    const inflight = await db
      .select({ id: usageLog.id })
      .from(usageLog)
      .where(
        and(
          eq(usageLog.gameId, id),
          eq(usageLog.succeeded, 0),
          isNull(usageLog.refundedAt),
          // Ignore rows orphaned by a crash — see STALE_STREAM_CUTOFF_MS.
          gt(usageLog.createdAt, Date.now() - STALE_STREAM_CUTOFF_MS)
        )
      )
      .limit(1);
    if (inflight.length > 0) {
      return sendError(reply, 409, {
        code: "CONFLICT",
        message: "A stream is in progress for this game",
      });
    }

    // Atomic swap with a guard on previous_code. Folding the ownership and
    // "has something to undo" checks into the WHERE clause makes concurrent
    // double-undo safe: only the first request matches; the second sees no
    // row. RETURNING hands back the restored code from the same statement, so
    // there's no second read to race against a concurrent write. Mirrors the
    // atomic-guarded-UPDATE pattern in services/usage/charge.ts.
    const restored = sqlite
      .query<{ current_code: string }, [number, string, string]>(
        `UPDATE games
         SET current_code = previous_code,
             previous_code = NULL,
             updated_at = ?
         WHERE id = ? AND user_id = ? AND previous_code IS NOT NULL
         RETURNING current_code`
      )
      .get(Date.now(), id, userId);

    if (!restored) {
      // Owned (we passed loadOwnedGame) but nothing to undo — the game has
      // never been refined, or the single undo slot was already consumed.
      return sendError(reply, 409, {
        code: "CONFLICT",
        message: "Nothing to undo",
      });
    }

    // Restored code comes straight from the UPDATE's RETURNING clause so the
    // client can update the preview without a second round-trip.
    return reply.send({
      currentCode: restored.current_code,
      canUndo: false,
    });
  });

  // POST /api/games/:id/thumbnail — save captured thumbnail
  app.post("/api/games/:id/thumbnail", async (request, reply) => {
    const id = parseGameId(request, reply);
    if (!id) return;

    const bodyResult = ThumbnailBody.safeParse(request.body);
    if (!bodyResult.success) {
      // Check if the thumbnail is too large (max string length exceeded)
      const sizeIssue = bodyResult.error.issues.find((i) => i.code === "too_big");
      if (sizeIssue) {
        return sendError(reply, 413, {
          code: "PAYLOAD_TOO_LARGE",
          message: "Thumbnail too large",
        });
      }
      return sendError(
        reply,
        400,
        validationError("Validation error", { issues: bodyResult.error.issues })
      );
    }

    const { thumbnail } = bodyResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return sendError(reply, 404, notFoundError());
    }

    await db.update(games).set({ thumbnail, updatedAt: Date.now() }).where(eq(games.id, id));

    return reply.status(204).send();
  });
}
