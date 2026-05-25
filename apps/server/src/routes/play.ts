// Public-facing routes for shared games. Lives under /api/play/* which is
// exempted from the auth guard in plugins/auth.ts. The remix endpoint here
// performs its own session check because it requires authentication while
// GET /api/play/:slug does not.

import { randomUUID } from "node:crypto";
import { gameLikes, games, messages } from "@arcadeai/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import {
  notFoundError,
  quotaError,
  sendError,
  unauthorizedError,
  validationError,
} from "../lib/errors.js";
import { loadPublicGame } from "../lib/ownership.js";
import { getSession } from "../plugins/auth.js";
import { likeGame, recordPlay, unlikeGame } from "../services/discover/likes.js";
import { InsufficientCreditsError, markSucceeded, recordRemix } from "../services/usage/charge.js";

// Slugs are generated as the first 8 chars of a UUIDv4 with dashes stripped
// (see routes/games.ts publish handler). They're exactly 8 lowercase hex
// characters. Tightening the schema here means a request with a malformed
// slug 400s before we run a needless DB lookup — and prevents the slug
// regex in og.ts / loadPublicGame from ever seeing pathological input.
const SlugParams = z.object({
  slug: z.string().regex(/^[0-9a-f]{8}$/i, "Invalid slug format"),
});

export async function playRoutes(app: FastifyInstance) {
  // GET /api/play/:slug — public view of a published game. Returns only
  // fields safe to expose to anonymous visitors. Hydrates `liked: boolean`
  // for authed viewers so the heart toggle reflects state on first paint.
  app.get("/api/play/:slug", async (request, reply) => {
    const parseResult = SlugParams.safeParse(request.params);
    if (!parseResult.success) {
      return sendError(reply, 400, validationError("Invalid slug"));
    }

    const game = await loadPublicGame(parseResult.data.slug);
    if (!game) {
      // 404 (not 403) on private/unknown to avoid leaking existence.
      return sendError(reply, 404, notFoundError());
    }

    let liked = false;
    try {
      const session = await getSession(request);
      if (session) {
        const rows = await db
          .select({ gameId: gameLikes.gameId })
          .from(gameLikes)
          .where(and(eq(gameLikes.gameId, game.id), eq(gameLikes.userId, session.user.id)))
          .limit(1);
        liked = Boolean(rows[0]);
      }
    } catch (err) {
      // Anonymous fallback is the right UX, but a thrown session lookup
      // is a real failure (auth-service degradation, DB outage). Without
      // a log line, ops can't distinguish "no session" from "session
      // lookup broken" — every authed visitor would silently appear as
      // anonymous on public games.
      request.log.warn({ err }, "getSession threw while hydrating liked state");
      liked = false;
    }

    return reply.send({ ...game, liked });
  });

  // POST /api/play/:slug/remix — duplicate a public game into the caller's
  // account. Auth is enforced manually because /api/play/* is auth-exempt.
  // Charges 0 credits but counts 1 against the free-tier lifetime cap so a
  // remix loop can't bypass the deployment-phase throttle.
  app.post("/api/play/:slug/remix", async (request, reply) => {
    const parseResult = SlugParams.safeParse(request.params);
    if (!parseResult.success) {
      return sendError(reply, 400, validationError("Invalid slug"));
    }

    let userId: string;
    try {
      const session = await getSession(request);
      if (!session) return sendError(reply, 401, unauthorizedError());
      userId = session.user.id;
    } catch (err) {
      request.log.warn({ err }, "getSession threw on remix; returning 401");
      return sendError(reply, 401, unauthorizedError());
    }

    const source = await loadPublicGame(parseResult.data.slug);
    if (!source) return sendError(reply, 404, notFoundError());

    const newId = randomUUID();
    const now = Date.now();

    // Insert the new game + seed message in one transaction so a partial
    // failure can't leave an orphan game without its source prompt.
    try {
      await db.transaction(async (tx) => {
        await tx.insert(games).values({
          id: newId,
          userId,
          title: `Remix of ${source.title}`,
          currentCode: source.currentCode,
          thumbnail: null,
          genre: null,
          originalPrompt: source.originalPrompt,
          isPublic: false,
          publicSlug: null,
          publishedAt: null,
          remixedFromGameId: source.id,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(messages).values({
          id: randomUUID(),
          gameId: newId,
          kind: "prompt",
          content: source.originalPrompt,
          createdAt: now,
        });
      });
    } catch (err) {
      request.log.error({ err }, "remix insert failed");
      return sendError(reply, 500, {
        code: "INTERNAL_ERROR",
        message: "Could not create remix",
      });
    }

    // Record the remix as a 0-credit generation. Free users at the lifetime
    // cap fail here — clean up the just-inserted game so we don't leave an
    // orphan, and surface the proper 402.
    let logId: string;
    try {
      ({ logId } = await recordRemix(userId, newId));
    } catch (err) {
      await db
        .delete(games)
        .where(eq(games.id, newId))
        .catch((delErr) => {
          // Cascade DELETE for messages is handled by the schema FK, so
          // failure here is unusual (disk full, locked DB). Log it so we
          // can spot orphaned remix rows in ops.
          request.log.error(
            { err: delErr instanceof Error ? delErr.message : String(delErr), gameId: newId },
            "failed to clean up remix game after recordRemix failure"
          );
        });
      if (err instanceof InsufficientCreditsError) {
        return sendError(
          reply,
          402,
          quotaError("insufficient_credits", { resetAt: err.resetAt, kind: err.kind })
        );
      }
      throw err;
    }

    // Mark the remix log row succeeded synchronously — there's no streaming
    // work to await; the remix is "done" the moment the row is inserted.
    // Log the failure rather than swallow so a stuck in-flight row is
    // visible in operations.
    await markSucceeded(logId).catch((err) => {
      request.log.error(
        { err: err instanceof Error ? err.message : String(err), logId },
        "markSucceeded failed for remix; usage_log row left in in-flight state"
      );
    });

    return reply.send({
      id: newId,
      title: `Remix of ${source.title}`,
      remixedFromGameId: source.id,
    });
  });

  // POST /api/play/:slug/play — increment the public play counter.
  // Fire-and-forget from the client; failures here never break the play
  // experience. Counts toward the discover-page sort.
  app.post("/api/play/:slug/play", async (request, reply) => {
    const parseResult = SlugParams.safeParse(request.params);
    if (!parseResult.success) {
      return sendError(reply, 400, validationError("Invalid slug"));
    }

    // Look up the gameId via slug. We could do this with a single UPDATE
    // ... WHERE public_slug = ?, but going through the helper keeps the
    // private/published filtering centralized.
    const game = await loadPublicGame(parseResult.data.slug);
    if (!game) return sendError(reply, 404, notFoundError());

    // recordPlay is documented as fire-and-forget and swallows its own
    // errors. Don't `await` it — letting the response return immediately
    // shaves a DB write off every public play-page load, and the counter
    // update still completes in the background.
    void recordPlay(game.id);
    return reply.send({ ok: true });
  });

  // POST /api/play/:slug/like — like a public game (auth required).
  // Idempotent: liking an already-liked game is a no-op. /api/play/* is
  // exempt from the auth guard, so we check the session manually.
  app.post("/api/play/:slug/like", async (request, reply) => {
    const parseResult = SlugParams.safeParse(request.params);
    if (!parseResult.success) {
      return sendError(reply, 400, validationError("Invalid slug"));
    }

    let userId: string;
    try {
      const session = await getSession(request);
      if (!session) return sendError(reply, 401, unauthorizedError());
      userId = session.user.id;
    } catch (err) {
      request.log.warn({ err }, "getSession threw on like; returning 401");
      return sendError(reply, 401, unauthorizedError());
    }

    // Resolve slug → id. Same private-filtering as remix.
    const rows = await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.publicSlug, parseResult.data.slug), eq(games.isPublic, true)))
      .limit(1);
    const game = rows[0];
    if (!game) return sendError(reply, 404, notFoundError());

    const result = await likeGame(game.id, userId);
    if (!result) return sendError(reply, 404, notFoundError());
    return reply.send(result);
  });

  // DELETE /api/play/:slug/like — unlike. Same auth + idempotency rules.
  app.delete("/api/play/:slug/like", async (request, reply) => {
    const parseResult = SlugParams.safeParse(request.params);
    if (!parseResult.success) {
      return sendError(reply, 400, validationError("Invalid slug"));
    }

    let userId: string;
    try {
      const session = await getSession(request);
      if (!session) return sendError(reply, 401, unauthorizedError());
      userId = session.user.id;
    } catch (err) {
      request.log.warn({ err }, "getSession threw on unlike; returning 401");
      return sendError(reply, 401, unauthorizedError());
    }

    const rows = await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.publicSlug, parseResult.data.slug), eq(games.isPublic, true)))
      .limit(1);
    const game = rows[0];
    if (!game) return sendError(reply, 404, notFoundError());

    const result = await unlikeGame(game.id, userId);
    if (!result) return sendError(reply, 404, notFoundError());
    return reply.send(result);
  });
}
