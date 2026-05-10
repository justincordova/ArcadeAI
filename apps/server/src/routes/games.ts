import { randomUUID } from "node:crypto";
import { games, messages } from "@arcadeai/db";
import { asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ConcurrencyError, acquire, release } from "../lib/active-streams.js";
import { db } from "../lib/db.js";
import {
  conflictError,
  notFoundError,
  quotaError,
  sendError,
  validationError,
} from "../lib/errors.js";
import { loadOwnedGame } from "../lib/ownership.js";
import { endSSE, startHeartbeat, writeSSE, writeSSEHeaders } from "../lib/sse.js";
import { categorizeError } from "../services/llm/categorize-error.js";
import { classifyPrompt } from "../services/llm/classify.js";
import { streamGame, streamRefinement, streamRepair } from "../services/llm/client.js";
import { embedPrompt } from "../services/llm/embed.js";
import { buildGenerationSystemPrompt } from "../services/llm/prompts/generation/index.js";
import { REPAIR_SYSTEM_PROMPT, buildRepairUserMessage } from "../services/llm/prompts/repair.js";
import { generateTitle } from "../services/llm/title.js";
import { retrieveExample } from "../services/rag/retrieve.js";
import { buildRefinementContext } from "../services/refinement/context.js";
import {
  InsufficientCreditsError,
  type RefundReason,
  checkUpfront,
  deduct,
  markSucceeded,
  refund,
} from "../services/usage/charge.js";
import { logRepair, markRepairSucceeded } from "../services/usage/repair-log.js";
import { applyResets } from "../services/usage/reset.js";

/**
 * Pick the best `RefundReason` for the failure that ended a stream. The
 * reasons are observability metadata — they show up on `usage_log` rows so
 * we can answer "what's the dominant failure mode?" from logs alone.
 *
 * Decisions:
 *  - `AbortError` → `abort` (user closed the tab; LLM SDK propagates as abort)
 *  - error message contains "timeout" / "timed out" → `timeout`
 *  - everything else (LLM 5xx, stream parse failure, etc.) → `llm_error`
 */
function classifyRefundReason(err: Error): RefundReason {
  if (err.name === "AbortError") return "abort";
  const msg = err.message.toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
  return "llm_error";
}

const CreateGameBody = z.object({
  prompt: z.string().trim().min(1).max(2000),
});

const GameIdParams = z.object({
  id: z.string().min(1),
});

const PatchGameBody = z.object({
  title: z.string().trim().min(1).max(80),
});

const ThumbnailBody = z.object({
  thumbnail: z.string().startsWith("data:image/png;base64,").max(350_000),
});

const RefineBody = z.object({
  feedback: z.string().trim().min(1).max(2000),
});

const RepairBody = z.object({
  error: z.object({
    message: z.string().min(1).max(2048),
    stack: z.string().max(16384).optional(),
  }),
});

// Per-user rate limit for streaming endpoints: 10 req/min (SPEC §14).
// Override the global `onRequest` hook with `preHandler` so the
// keyGenerator runs AFTER the auth preHandler has populated
// `request.authSession`. Without this, the keyGenerator falls back to
// `req.ip` for every authenticated request, defeating per-user keying.
const perUser10PerMin = {
  rateLimit: {
    max: 10,
    timeWindow: "1 minute",
    hook: "preHandler" as const,
    keyGenerator: (req: import("fastify").FastifyRequest) =>
      (req as import("fastify").FastifyRequest & { authSession?: { user?: { id?: string } } })
        .authSession?.user?.id ?? req.ip,
  },
};

export async function gamesRoutes(app: FastifyInstance) {
  // POST /api/games — create game row and stream generation
  app.post("/api/games", { config: perUser10PerMin }, async (request, reply) => {
    const parseResult = CreateGameBody.safeParse(request.body);
    if (!parseResult.success) {
      return sendError(
        reply,
        400,
        validationError("Validation error", { issues: parseResult.error.issues })
      );
    }

    const { prompt } = parseResult.data;
    const userId = request.authSession.user.id;

    // Upfront credit check (before creating game row per SPEC §11). The
    // atomic guard inside `deduct` is the source of truth — this is a UX
    // optimization to surface 402 before any DB writes or SSE handshakes.
    const userState = await applyResets(userId);
    if (!userState) return sendError(reply, 404, notFoundError("User not found"));

    const upfront = checkUpfront(userState, "generation");
    if (upfront) {
      return sendError(reply, 402, quotaError(upfront.error, upfront));
    }

    // Concurrency cap: 1 active stream per user
    try {
      acquire(userId);
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        return sendError(reply, 409, conflictError(err.message));
      }
      throw err;
    }

    // From here on, we must always release(userId) on every exit path.
    try {
      const id = randomUUID();
      const now = Date.now();
      const title = prompt.slice(0, 40);

      // Insert game row and initial prompt message in a single transaction
      await db.transaction(async (tx) => {
        await tx.insert(games).values({
          id,
          userId,
          title,
          currentCode: "",
          thumbnail: null,
          genre: null,
          originalPrompt: prompt,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(messages).values({
          id: randomUUID(),
          gameId: id,
          kind: "prompt",
          content: prompt,
          createdAt: now,
        });
      });

      // Deduct credits (game row now exists for the FK reference).
      // The upfront 402 check above prevents the common "no credits" case.
      // This catch handles TOCTOU (counters drained between check and deduct)
      // and any other unexpected pre-stream failure — clean up the empty
      // game row and return a real status code instead of 500.
      let logId: string;
      try {
        ({ logId } = await deduct(userId, "generation", id));
      } catch (err) {
        await db
          .delete(games)
          .where(eq(games.id, id))
          .catch(() => {});
        if (err instanceof InsufficientCreditsError) {
          return sendError(
            reply,
            402,
            quotaError("insufficient_credits", { resetAt: err.resetAt, kind: err.kind })
          );
        }
        throw err;
      }

      // Hijack response for SSE
      reply.hijack();
      writeSSEHeaders(reply, request);
      writeSSE(reply, "meta", { gameId: id, placeholderTitle: title });

      // Heartbeat keeps the connection warm against intermediate proxy idle
      // timeouts during the long pre-LLM fanout and the multi-second model
      // streams. The stop function is called in the finally block below.
      const stopHeartbeat = startHeartbeat(reply);

      const ac = new AbortController();
      let clientClosed = false;

      request.raw.on("close", () => {
        clientClosed = true;
        ac.abort();
      });

      // Pre-LLM parallel fanout (SPEC §7): classify genre, embed prompt,
      // generate title — all three branches run concurrently.
      const [classRes, embedRes, titleRes] = await Promise.allSettled([
        classifyPrompt(prompt, request.log),
        embedPrompt(prompt, request.log),
        generateTitle(prompt, request.log),
      ]);

      const { genre, styleTags } =
        classRes.status === "fulfilled"
          ? classRes.value
          : { genre: "other" as const, styleTags: [] };

      const embedding = embedRes.status === "fulfilled" ? embedRes.value : null;
      if (embedRes.status === "rejected") {
        request.log.warn(
          {
            err:
              embedRes.reason instanceof Error ? embedRes.reason.message : String(embedRes.reason),
          },
          "embedPrompt failed; continuing without RAG retrieval"
        );
      }

      // Persist genre before streaming
      await db.update(games).set({ genre, updatedAt: Date.now() }).where(eq(games.id, id));

      // Persist title if generation succeeded; otherwise keep placeholder
      if (titleRes.status === "fulfilled") {
        await db
          .update(games)
          .set({ title: titleRes.value, updatedAt: Date.now() })
          .where(eq(games.id, id));
      } else {
        request.log.warn(
          {
            err:
              titleRes.reason instanceof Error ? titleRes.reason.message : String(titleRes.reason),
          },
          "title generation failed; keeping placeholder"
        );
      }

      const ragHtml = await retrieveExample({
        embedding,
        genre,
        log: request.log,
      });
      const system = buildGenerationSystemPrompt({ genre, styleTags, example: ragHtml });

      let accumulatedCode = "";
      let streamError: Error | null = null;

      try {
        const result = await streamGame({
          system,
          prompt,
          signal: ac.signal,
          logger: request.log,
        });

        for await (const delta of result.textStream) {
          accumulatedCode += delta;
          if (!clientClosed) {
            writeSSE(reply, "chunk", { delta });
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error("Unknown error");
      }

      // Persist whatever we have
      try {
        await db
          .update(games)
          .set({ currentCode: accumulatedCode, updatedAt: Date.now() })
          .where(eq(games.id, id));
      } catch {
        // Persistence failure is logged-and-swallowed
      }

      // Finalize: markSucceeded or refund (mutually exclusive, each runs once)
      if (streamError) {
        await refund(logId, {
          logger: request.log,
          reason: classifyRefundReason(streamError),
        }).catch(() => {});
      } else {
        // Success (including user-cancel per SPEC §14: credits not refunded on cancel)
        await markSucceeded(logId).catch(() => {});
      }

      stopHeartbeat();

      if (!clientClosed) {
        if (streamError) {
          writeSSE(reply, "error", { message: streamError.message });
        } else {
          writeSSE(reply, "done", {});
        }
        endSSE(reply);
      }
    } finally {
      release(userId);
    }
  });

  // GET /api/games/:id — get game with messages
  app.get("/api/games/:id", async (request, reply) => {
    const parseResult = GameIdParams.safeParse(request.params);
    if (!parseResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }

    const { id } = parseResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return sendError(reply, 404, notFoundError());
    }

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.gameId, id))
      .orderBy(asc(messages.createdAt));

    return reply.send({ ...game, messages: msgs });
  });

  // DELETE /api/games/:id
  app.delete("/api/games/:id", async (request, reply) => {
    const parseResult = GameIdParams.safeParse(request.params);
    if (!parseResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }

    const { id } = parseResult.data;
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

    const rows = await db
      .select({
        id: games.id,
        title: games.title,
        thumbnail: games.thumbnail,
        updatedAt: games.updatedAt,
        createdAt: games.createdAt,
        isPublic: games.isPublic,
        publicSlug: games.publicSlug,
        genre: games.genre,
      })
      .from(games)
      .where(eq(games.userId, userId))
      .orderBy(desc(games.updatedAt));

    return reply.send(rows);
  });

  // PATCH /api/games/:id — rename game
  app.patch("/api/games/:id", async (request, reply) => {
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }

    const bodyResult = PatchGameBody.safeParse(request.body);
    if (!bodyResult.success) {
      return sendError(
        reply,
        400,
        validationError("Validation error", { issues: bodyResult.error.issues })
      );
    }

    const { id } = paramsResult.data;
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
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }
    const { id } = paramsResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) return sendError(reply, 404, notFoundError());
    if (!game.currentCode) {
      return sendError(reply, 400, validationError("Game has no code to publish"));
    }

    let slug = game.publicSlug;
    if (!slug) {
      // Generate a unique slug. 8 hex chars = 4 billion options; collisions
      // are vanishingly rare but the unique-index will reject duplicates so
      // we retry up to 3 times before giving up.
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = randomUUID().replace(/-/g, "").slice(0, 8);
        try {
          await db.update(games).set({ publicSlug: candidate }).where(eq(games.id, id));
          slug = candidate;
          break;
        } catch {
          // unique constraint hit; retry
        }
      }
      if (!slug) {
        return sendError(reply, 500, {
          code: "INTERNAL_ERROR",
          message: "Could not generate public slug; please retry",
        });
      }
    }

    const now = Date.now();
    await db
      .update(games)
      .set({ isPublic: true, publishedAt: now, updatedAt: now })
      .where(eq(games.id, id));

    return reply.send({ slug, isPublic: true, publishedAt: now });
  });

  // POST /api/games/:id/unpublish — keep the slug for stable re-publish, but
  // hide the game from /play/:slug.
  app.post("/api/games/:id/unpublish", async (request, reply) => {
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }
    const { id } = paramsResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) return sendError(reply, 404, notFoundError());

    await db.update(games).set({ isPublic: false, updatedAt: Date.now() }).where(eq(games.id, id));

    return reply.send({ isPublic: false });
  });

  // POST /api/games/:id/thumbnail — save captured thumbnail
  app.post("/api/games/:id/thumbnail", async (request, reply) => {
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }

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

    const { id } = paramsResult.data;
    const { thumbnail } = bodyResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return sendError(reply, 404, notFoundError());
    }

    await db.update(games).set({ thumbnail, updatedAt: Date.now() }).where(eq(games.id, id));

    return reply.status(204).send();
  });

  // POST /api/games/:id/refine — refinement turn with SSE streaming
  app.post("/api/games/:id/refine", { config: perUser10PerMin }, async (request, reply) => {
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }

    const bodyResult = RefineBody.safeParse(request.body);
    if (!bodyResult.success) {
      return sendError(
        reply,
        400,
        validationError("Validation error", { issues: bodyResult.error.issues })
      );
    }

    const { id } = paramsResult.data;
    const { feedback } = bodyResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return sendError(reply, 404, notFoundError());
    }

    if (!game.currentCode) {
      return sendError(reply, 400, validationError("Game has no code to refine"));
    }

    // Upfront credit check before SSE (402 before any bytes emitted per SPEC §11)
    const refineUserState = await applyResets(userId);
    if (!refineUserState) return sendError(reply, 404, notFoundError("User not found"));

    const refineUpfront = checkUpfront(refineUserState, "refinement");
    if (refineUpfront) {
      return sendError(reply, 402, quotaError(refineUpfront.error, refineUpfront));
    }

    // Concurrency cap: 1 active stream per user
    try {
      acquire(userId);
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        return sendError(reply, 409, conflictError(err.message));
      }
      throw err;
    }

    try {
      // Deduct credits. Same TOCTOU/refund considerations as POST /api/games.
      let logId: string;
      try {
        ({ logId } = await deduct(userId, "refinement", id));
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return sendError(
            reply,
            402,
            quotaError("insufficient_credits", { resetAt: err.resetAt, kind: err.kind })
          );
        }
        throw err;
      }

      // Pre-stream setup: persist feedback row, load history, build context.
      // If any of this fails before we hijack the response, refund the
      // deduction and surface a proper status code instead of a 500 with no
      // record of the request.
      let system: string;
      let refinementPrompt: string;
      try {
        const now = Date.now();
        const feedbackId = randomUUID();

        await db.insert(messages).values({
          id: feedbackId,
          gameId: id,
          kind: "feedback",
          content: feedback,
          createdAt: now,
        });

        const pastRows = await db
          .select({ content: messages.content, id: messages.id, kind: messages.kind })
          .from(messages)
          .where(eq(messages.gameId, id))
          .orderBy(asc(messages.createdAt));

        const pastFeedback = pastRows
          .filter((r) => r.kind === "feedback" && r.id !== feedbackId)
          .map((r) => r.content);

        ({ system, prompt: refinementPrompt } = await buildRefinementContext({
          game,
          feedback,
          pastFeedback,
          logger: request.log,
        }));
      } catch (err) {
        // Failure here is post-deduct, pre-stream — feedback insert, history
        // load, or context build. All three are persistence/IO; classify
        // accordingly. validation_error is reserved for upstream zod failures.
        await refund(logId, { logger: request.log, reason: "persistence_error" }).catch(() => {});
        throw err;
      }

      reply.hijack();
      writeSSEHeaders(reply, request);
      writeSSE(reply, "meta", { gameId: id, placeholderTitle: game.title });
      const stopHeartbeat = startHeartbeat(reply);

      const ac = new AbortController();
      let clientClosed = false;

      request.raw.on("close", () => {
        clientClosed = true;
        ac.abort();
      });

      let accumulatedCode = "";
      let streamError: Error | null = null;

      try {
        const result = await streamRefinement({
          system,
          prompt: refinementPrompt,
          signal: ac.signal,
          logger: request.log,
        });

        for await (const delta of result.textStream) {
          accumulatedCode += delta;
          if (!clientClosed) {
            writeSSE(reply, "chunk", { delta });
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error("Unknown error");
      }

      // Persist accumulated code whether or not the client disconnected,
      // so a user cancel doesn't silently discard work already streamed.
      // Only skip on a server-side stream error (the model failed).
      if (!streamError && accumulatedCode) {
        try {
          await db
            .update(games)
            .set({ currentCode: accumulatedCode, updatedAt: Date.now() })
            .where(eq(games.id, id));
        } catch {
          // persistence failure is non-fatal
        }
      }

      // Finalize credits
      if (streamError) {
        await refund(logId, {
          logger: request.log,
          reason: classifyRefundReason(streamError),
        }).catch(() => {});
      } else {
        await markSucceeded(logId).catch(() => {});
      }

      stopHeartbeat();

      if (!clientClosed) {
        if (streamError) {
          writeSSE(reply, "error", { message: streamError.message });
        } else {
          writeSSE(reply, "done", {});
        }
        endSSE(reply);
      }
    } finally {
      release(userId);
    }
  });

  // POST /api/games/:id/repair — auto-repair loop (SPEC §9, §11)
  app.post("/api/games/:id/repair", { config: perUser10PerMin }, async (request, reply) => {
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }

    const bodyResult = RepairBody.safeParse(request.body);
    if (!bodyResult.success) {
      return sendError(
        reply,
        400,
        validationError("Validation error", { issues: bodyResult.error.issues })
      );
    }

    const { id } = paramsResult.data;
    const { error: gameError } = bodyResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return sendError(reply, 404, notFoundError());
    }

    // Concurrency cap: repair counts against the same 1-stream-per-user limit
    try {
      acquire(userId);
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        return sendError(reply, 409, conflictError(err.message));
      }
      throw err;
    }

    try {
      // Open SSE before log insert so the client gets meta promptly
      reply.hijack();
      writeSSEHeaders(reply, request);
      writeSSE(reply, "meta", { gameId: game.id, placeholderTitle: game.title });
      const stopHeartbeat = startHeartbeat(reply);

      // Insert observability row (credits_charged=0 per SPEC §10)
      const { logId } = await logRepair(userId, game.id);

      // Categorize error (soft-fail per plan §3)
      const { category } = await categorizeError(gameError, request.log);

      const userMessage = buildRepairUserMessage({
        originalPrompt: game.originalPrompt ?? "",
        category,
        message: gameError.message,
        stack: gameError.stack,
        code: game.currentCode ?? "",
      });

      const ac = new AbortController();
      let clientClosed = false;
      request.raw.on("close", () => {
        clientClosed = true;
        ac.abort();
      });

      let accumulated = "";
      let streamError: Error | null = null;

      try {
        const result = await streamRepair({
          system: REPAIR_SYSTEM_PROMPT,
          userMessage,
          signal: ac.signal,
          logger: request.log,
        });

        for await (const delta of result.textStream) {
          accumulated += delta;
          if (!clientClosed) {
            writeSSE(reply, "chunk", { delta });
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error("Unknown error");
      }

      if (!streamError && accumulated) {
        // Persist repaired code
        try {
          await db
            .update(games)
            .set({ currentCode: accumulated, updatedAt: Date.now() })
            .where(eq(games.id, id));
        } catch {
          // persistence failure is non-fatal
        }
        await markRepairSucceeded(logId).catch(() => {});
      }

      stopHeartbeat();

      if (!clientClosed) {
        if (streamError) {
          writeSSE(reply, "error", { message: streamError.message });
        } else {
          writeSSE(reply, "done", {});
        }
        endSSE(reply);
      }
    } finally {
      release(userId);
    }
  });
}
