import { randomUUID } from "node:crypto";
import { games, messages } from "@arcadeai/db";
import { CREDIT_COSTS, TIER_CREDIT_LIMITS } from "@arcadeai/shared";
import { asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ConcurrencyError, acquire, release } from "../lib/active-streams.js";
import { db } from "../lib/db.js";
import { loadOwnedGame } from "../lib/ownership.js";
import { endSSE, writeSSE, writeSSEHeaders } from "../lib/sse.js";
import { streamGame, streamRefinement } from "../services/llm/client.js";
import { embedPrompt } from "../services/llm/embed.js";
import { buildGenerationSystemPrompt } from "../services/llm/prompts/generation.js";
import { retrieveExample } from "../services/rag/retrieve.js";
import { buildRefinementContext } from "../services/refinement/context.js";
import {
  InsufficientCreditsError,
  deduct,
  markSucceeded,
  refund,
} from "../services/usage/charge.js";
import { applyResets } from "../services/usage/reset.js";

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

export async function gamesRoutes(app: FastifyInstance) {
  // POST /api/games — create game row and stream generation
  app.post("/api/games", async (request, reply) => {
    const parseResult = CreateGameBody.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        issues: parseResult.error.issues,
      });
    }

    const { prompt } = parseResult.data;
    const userId = request.authSession.user.id;

    // Upfront credit check (before creating game row per SPEC §11)
    const userState = await applyResets(userId);
    if (!userState) return reply.status(404).send({ error: "User not found" });

    const cost = CREDIT_COSTS.generation;
    const limits = TIER_CREDIT_LIMITS[userState.tier as keyof typeof TIER_CREDIT_LIMITS];
    if (userState.tier !== "admin") {
      if (limits.dailyEnforced && userState.creditsRemainingDaily < cost) {
        return reply.status(402).send({
          error: "insufficient_credits",
          resetAt: userState.dailyResetAt,
        });
      }
      if (userState.creditsRemainingMonthly < cost) {
        return reply.status(402).send({
          error: "insufficient_credits",
          resetAt: userState.monthlyResetAt,
        });
      }
    }

    // Concurrency cap: 1 active stream per user
    try {
      acquire(userId);
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        return reply.status(409).send({ error: err.message });
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
          return reply.status(402).send({
            error: "insufficient_credits",
            resetAt: err.resetAt,
          });
        }
        throw err;
      }

      // Hijack response for SSE
      reply.hijack();
      writeSSEHeaders(reply);
      writeSSE(reply, "meta", { gameId: id, placeholderTitle: title });

      const ac = new AbortController();
      let clientClosed = false;

      request.raw.on("close", () => {
        clientClosed = true;
        ac.abort();
      });

      // Pre-LLM parallel fanout per SPEC §7. Today this is just the prompt
      // embedding; step 10 will add a classify call as a sibling promise
      // without restructuring this block. `null` is the graceful-degrade
      // signal for both legs (retrieval falls back to no few-shot).
      const [embedding] = await Promise.all([
        embedPrompt(prompt).catch((err) => {
          request.log.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "embedPrompt failed; continuing without RAG retrieval"
          );
          return null;
        }),
        // step 10: classifyGenre(prompt),
      ]);
      const genre = "other"; // step 10 replaces this with classifier output
      const ragHtml = await retrieveExample({
        embedding,
        genre,
        log: request.log,
      });
      const system = buildGenerationSystemPrompt({ ragExample: ragHtml });

      let accumulatedCode = "";
      let streamError: Error | null = null;

      try {
        const result = await streamGame({
          system,
          prompt,
          signal: ac.signal,
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
        // Server-side error: refund credits
        await refund(logId).catch(() => {});
      } else {
        // Success (including user-cancel per SPEC §14: credits not refunded on cancel)
        await markSucceeded(logId).catch(() => {});
      }

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
      return reply.status(400).send({ error: "Invalid id" });
    }

    const { id } = parseResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return reply.status(404).send({ error: "Not found" });
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
      return reply.status(400).send({ error: "Invalid id" });
    }

    const { id } = parseResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return reply.status(404).send({ error: "Not found" });
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
      return reply.status(400).send({ error: "Invalid id" });
    }

    const bodyResult = PatchGameBody.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        issues: bodyResult.error.issues,
      });
    }

    const { id } = paramsResult.data;
    const { title } = bodyResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return reply.status(404).send({ error: "Not found" });
    }

    const now = Date.now();
    await db.update(games).set({ title, updatedAt: now }).where(eq(games.id, id));

    return reply.send({ id, title, updatedAt: now });
  });

  // POST /api/games/:id/thumbnail — save captured thumbnail
  app.post("/api/games/:id/thumbnail", async (request, reply) => {
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ error: "Invalid id" });
    }

    const bodyResult = ThumbnailBody.safeParse(request.body);
    if (!bodyResult.success) {
      // Check if the thumbnail is too large (max string length exceeded)
      const sizeIssue = bodyResult.error.issues.find((i) => i.code === "too_big");
      if (sizeIssue) {
        return reply.status(413).send({ error: "Thumbnail too large" });
      }
      return reply.status(400).send({
        error: "Validation error",
        issues: bodyResult.error.issues,
      });
    }

    const { id } = paramsResult.data;
    const { thumbnail } = bodyResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return reply.status(404).send({ error: "Not found" });
    }

    await db.update(games).set({ thumbnail, updatedAt: Date.now() }).where(eq(games.id, id));

    return reply.status(204).send();
  });

  // POST /api/games/:id/refine — refinement turn with SSE streaming
  app.post("/api/games/:id/refine", async (request, reply) => {
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ error: "Invalid id" });
    }

    const bodyResult = RefineBody.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        issues: bodyResult.error.issues,
      });
    }

    const { id } = paramsResult.data;
    const { feedback } = bodyResult.data;
    const userId = request.authSession.user.id;

    const game = await loadOwnedGame(id, userId);
    if (!game) {
      return reply.status(404).send({ error: "Not found" });
    }

    if (!game.currentCode) {
      return reply.status(400).send({ error: "Game has no code to refine" });
    }

    // Upfront credit check before SSE (402 before any bytes emitted per SPEC §11)
    const refineUserState = await applyResets(userId);
    if (!refineUserState) return reply.status(404).send({ error: "User not found" });

    const refineCost = CREDIT_COSTS.refinement;
    const refineLimits =
      TIER_CREDIT_LIMITS[refineUserState.tier as keyof typeof TIER_CREDIT_LIMITS];
    if (refineUserState.tier !== "admin") {
      if (refineLimits.dailyEnforced && refineUserState.creditsRemainingDaily < refineCost) {
        return reply.status(402).send({
          error: "insufficient_credits",
          resetAt: refineUserState.dailyResetAt,
        });
      }
      if (refineUserState.creditsRemainingMonthly < refineCost) {
        return reply.status(402).send({
          error: "insufficient_credits",
          resetAt: refineUserState.monthlyResetAt,
        });
      }
    }

    // Concurrency cap: 1 active stream per user
    try {
      acquire(userId);
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        return reply.status(409).send({ error: err.message });
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
          return reply.status(402).send({
            error: "insufficient_credits",
            resetAt: err.resetAt,
          });
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
        }));
      } catch (err) {
        await refund(logId).catch(() => {});
        throw err;
      }

      reply.hijack();
      writeSSEHeaders(reply);
      writeSSE(reply, "meta", { gameId: id, placeholderTitle: game.title });

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

      // Persist refined code (only on clean completion)
      if (!streamError && !clientClosed && accumulatedCode) {
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
        await refund(logId).catch(() => {});
      } else {
        await markSucceeded(logId).catch(() => {});
      }

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
