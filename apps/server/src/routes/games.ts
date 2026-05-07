import { randomUUID } from "node:crypto";
import { games, messages } from "@arcadeai/db";
import { asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ConcurrencyError, acquire, release } from "../lib/active-streams.js";
import { db } from "../lib/db.js";
import { loadOwnedGame } from "../lib/ownership.js";
import { endSSE, writeSSE, writeSSEHeaders } from "../lib/sse.js";
import { streamGame, streamRefinement } from "../services/llm/client.js";
import { buildRefinementContext } from "../services/refinement/context.js";

const CreateGameBody = z.object({
  prompt: z.string().min(1).max(2000),
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
  feedback: z.string().min(1).max(2000),
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

      let accumulatedCode = "";
      let streamError: Error | null = null;

      try {
        const result = await streamGame({ prompt, signal: ac.signal });

        for await (const delta of result.textStream) {
          accumulatedCode += delta;
          if (!clientClosed) {
            writeSSE(reply, "chunk", { delta });
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error("Unknown error");
      }

      // Persist whatever we have. If the client closed mid-stream we still
      // save the partial code so the user doesn't lose it on a tab-close race.
      try {
        await db
          .update(games)
          .set({ currentCode: accumulatedCode, updatedAt: Date.now() })
          .where(eq(games.id, id));
      } catch {
        // Persistence failure is logged-and-swallowed; we still need to close
        // the SSE stream cleanly. The client already has the code via chunks.
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
      const now = Date.now();
      const feedbackId = randomUUID();

      // Persist the feedback message
      await db.insert(messages).values({
        id: feedbackId,
        gameId: id,
        kind: "feedback",
        content: feedback,
        createdAt: now,
      });

      // Load past feedback messages (excluding the current one) for context
      const pastRows = await db
        .select({ content: messages.content })
        .from(messages)
        .where(eq(messages.gameId, id))
        .orderBy(asc(messages.createdAt));

      const pastFeedback = pastRows
        .filter((r) => r.content !== feedback)
        .filter((_, i) => {
          // exclude the last row (the one we just inserted)
          return i < pastRows.length - 1;
        })
        .filter((r) => {
          // only feedback rows (not the initial prompt)
          const idx = pastRows.findIndex((pr) => pr.content === r.content);
          return idx > 0; // skip the first message (the prompt)
        })
        .map((r) => r.content);

      const { system, prompt } = await buildRefinementContext({
        game,
        feedback,
        pastFeedback,
      });

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
        const result = await streamRefinement({ system, prompt, signal: ac.signal });

        for await (const delta of result.textStream) {
          accumulatedCode += delta;
          if (!clientClosed) {
            writeSSE(reply, "chunk", { delta });
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error("Unknown error");
      }

      // Persist refined code (only on clean completion, not on error or abort)
      if (!streamError && !clientClosed && accumulatedCode) {
        try {
          await db
            .update(games)
            .set({ currentCode: accumulatedCode, updatedAt: Date.now() })
            .where(eq(games.id, id));
        } catch {
          // persistence failure is non-fatal; client already has code via chunks
        }
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
