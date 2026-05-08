// Public-facing routes for shared games. Lives under /api/play/* which is
// exempted from the auth guard in plugins/auth.ts. The remix endpoint here
// performs its own session check because it requires authentication while
// GET /api/play/:slug does not.

import { randomUUID } from "node:crypto";
import { games, messages } from "@arcadeai/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { loadPublicGame } from "../lib/ownership.js";
import { getSession } from "../plugins/auth.js";
import { InsufficientCreditsError, markSucceeded, recordRemix } from "../services/usage/charge.js";

const SlugParams = z.object({
  slug: z.string().min(1).max(64),
});

export async function playRoutes(app: FastifyInstance) {
  // GET /api/play/:slug — public view of a published game. Returns only
  // fields safe to expose to anonymous visitors.
  app.get("/api/play/:slug", async (request, reply) => {
    const parseResult = SlugParams.safeParse(request.params);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Invalid slug" });
    }

    const game = await loadPublicGame(parseResult.data.slug);
    if (!game) {
      // 404 (not 403) on private/unknown to avoid leaking existence.
      return reply.status(404).send({ error: "Not found" });
    }

    return reply.send(game);
  });

  // POST /api/play/:slug/remix — duplicate a public game into the caller's
  // account. Auth is enforced manually because /api/play/* is auth-exempt.
  // Charges 0 credits but counts 1 against the free-tier lifetime cap so a
  // remix loop can't bypass the deployment-phase throttle.
  app.post("/api/play/:slug/remix", async (request, reply) => {
    const parseResult = SlugParams.safeParse(request.params);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Invalid slug" });
    }

    let userId: string;
    try {
      const session = await getSession(request);
      if (!session) return reply.status(401).send({ error: "Unauthorized" });
      userId = session.user.id;
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const source = await loadPublicGame(parseResult.data.slug);
    if (!source) return reply.status(404).send({ error: "Not found" });

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
      return reply.status(500).send({ error: "Could not create remix" });
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
        .catch(() => {});
      if (err instanceof InsufficientCreditsError) {
        return reply.status(402).send({
          error: "insufficient_credits",
          resetAt: err.resetAt,
          kind: err.kind,
        });
      }
      throw err;
    }

    // Mark the remix log row succeeded synchronously — there's no streaming
    // work to await; the remix is "done" the moment the row is inserted.
    await markSucceeded(logId).catch(() => {});

    return reply.send({
      id: newId,
      title: `Remix of ${source.title}`,
      remixedFromGameId: source.id,
    });
  });
}
