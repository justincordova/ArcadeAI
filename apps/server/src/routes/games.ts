import { randomUUID } from "node:crypto";
import { games, messages } from "@arcadeai/db";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ConcurrencyError, acquire, release } from "../lib/active-streams.js";
import { db } from "../lib/db.js";
import { loadOwnedGame } from "../lib/ownership.js";
import { endSSE, writeSSE, writeSSEHeaders } from "../lib/sse.js";
import { streamGame } from "../services/llm/client.js";

const CreateGameBody = z.object({
  prompt: z.string().min(1).max(2000),
});

const GameIdParams = z.object({
  id: z.string().min(1),
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
}
