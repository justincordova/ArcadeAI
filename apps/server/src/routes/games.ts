import { randomUUID } from "node:crypto";
import { games, messages, usageLog } from "@arcadeai/db";
import { and, asc, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ConcurrencyError, acquire, release } from "../lib/active-streams.js";
import { db, sqlite } from "../lib/db.js";
import {
  conflictError,
  notFoundError,
  quotaError,
  sendError,
  validationError,
} from "../lib/errors.js";
import { loadOwnedGame } from "../lib/ownership.js";
import { serveThumbnail } from "../lib/serve-thumbnail.js";
import { endSSE, startHeartbeat, writeSSE, writeSSEHeaders } from "../lib/sse.js";
import { categorizeError } from "../services/llm/categorize-error.js";
import { classifyPrompt } from "../services/llm/classify.js";
import { streamGame, streamRefinement, streamRepair } from "../services/llm/client.js";
import { generateDiffSummary } from "../services/llm/diff-summary.js";
import { embedPrompt } from "../services/llm/embed.js";
import { buildGenerationSystemPrompt } from "../services/llm/prompts/generation/index.js";
import { REPAIR_SYSTEM_PROMPT, buildRepairUserMessage } from "../services/llm/prompts/repair.js";
import { sanitizeHtmlOutput } from "../services/llm/sanitize-output.js";
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
import { logRepair, markRepairFailed, markRepairSucceeded } from "../services/usage/repair-log.js";
import { applyResets } from "../services/usage/reset.js";

/**
 * Pick the best `RefundReason` for the failure that ended a stream. The
 * reasons are observability metadata — they show up on `usage_log` rows so
 * we can answer "what's the dominant failure mode?" from logs alone.
 *
 * With background-stream semantics, client disconnect no longer aborts the
 * LLM — generations finish even if the user navigates away. So `AbortError`
 * is now produced almost exclusively by the server-side timeout
 * (`withTimeout`), and is classified by the error message first.
 *
 * Decisions:
 *  - error message contains "timeout" / "timed out" → `timeout`
 *  - `AbortError` (without a timeout message) → `abort` (rare; reserved
 *    for any future explicit-cancel pathway)
 *  - everything else (LLM 5xx, stream parse failure, etc.) → `llm_error`
 */
function classifyRefundReason(err: Error): RefundReason {
  const msg = err.message.toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
  if (err.name === "AbortError") return "abort";
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

// In-flight usage_log rows older than this are treated as dead, not active.
// The predicates on GET /api/games/:id (`inProgress`) and POST /:id/undo
// (stream guard) key on `succeeded=0 AND refunded_at IS NULL` — a state
// that normally resolves when the stream finalizes. But a hard crash
// (OOM, kill -9) skips finalization, and nothing sweeps the rows at
// startup, so without a cutoff the game reports "generating" forever and
// undo is permanently 409'd. 15 minutes comfortably exceeds the 180s LLM
// timeout plus pre/post-stream work, so no live stream is ever excluded.
const STALE_STREAM_CUTOFF_MS = 15 * 60_000;

// Rolling 24h cap on repair attempts per user. Repairs are credit-free per
// SPEC §10 and exempt from the lifetime caps, which makes them the ONLY
// full-Claude-stream endpoint with no cost control: a user (including a
// free-tier account that exhausted its lifetime caps) could fabricate
// error payloads and drive 10 streams/min indefinitely at zero credit
// cost. The client's auto-repair fires at most 2 attempts per error, so a
// generous budget never touches legitimate use while bounding worst-case
// spend. Checked as a plain count — a small racy overshoot is acceptable
// for a budget (unlike the atomic credit guards).
const REPAIR_DAILY_LIMIT = 50;
const REPAIR_WINDOW_MS = 24 * 3600_000;

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
    // `stopHeartbeat` is hoisted so the `finally` clause can call it even
    // if an exception escapes between `startHeartbeat()` and the explicit
    // `stopHeartbeat()` call. Previously a throw between those two points
    // (e.g. from `retrieveExample` or any await before the model stream
    // started) left a setInterval running forever, writing :keep-alive
    // frames to a destroyed socket on every tick.
    let stopHeartbeat: (() => void) | null = null;
    // Hoisted so the post-hijack catch can refund against it.
    let logId: string | null = null;
    // Whether reply.hijack() has run. The outer catch must know: after the
    // hijack, errors have to be written as SSE frames by hand; before it,
    // they must be rethrown to Fastify's error handler — writing SSE frames
    // to a non-hijacked reply emits an implicit 200 with no Content-Type and
    // no CORS headers instead of a proper 500 JSON body.
    let hijacked = false;
    try {
      const id = randomUUID();
      const now = Date.now();
      const title = prompt.slice(0, 40);

      // Insert game row and initial prompt message in a single transaction.
      // The callback MUST be synchronous: Drizzle's bun-sqlite driver wraps a
      // sync callback in bun's native transaction (real BEGIN/COMMIT/ROLLBACK),
      // but an `async` callback commits at the first `await`, so a failure on
      // the second insert would NOT roll back the first — leaving an orphan
      // game with no prompt message. Use `.run()` so each statement executes
      // synchronously inside the transaction.
      db.transaction((tx) => {
        tx.insert(games)
          .values({
            id,
            userId,
            title,
            currentCode: "",
            thumbnail: null,
            genre: null,
            originalPrompt: prompt,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        tx.insert(messages)
          .values({
            id: randomUUID(),
            gameId: id,
            kind: "prompt",
            content: prompt,
            createdAt: now,
          })
          .run();
      });

      // Deduct credits (game row now exists for the FK reference).
      // The upfront 402 check above prevents the common "no credits" case.
      // This catch handles TOCTOU (counters drained between check and deduct)
      // and any other unexpected pre-stream failure — clean up the empty
      // game row and return a real status code instead of 500.
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
      hijacked = true;
      writeSSEHeaders(reply, request);
      writeSSE(reply, "meta", { gameId: id, placeholderTitle: title });

      // Heartbeat keeps the connection warm against intermediate proxy idle
      // timeouts during the long pre-LLM fanout and the multi-second model
      // streams. The stop function is called in the finally block below.
      stopHeartbeat = startHeartbeat(reply);

      // Background-stream semantics: when the SSE client disconnects (tab
      // close, navigation away, network drop), we stop writing SSE frames
      // but DO NOT abort the LLM call. The model finishes, the result is
      // persisted to current_code, credits are charged as a success. The
      // user returns to /game/<id> later and sees the completed game. This
      // matches "fire-and-forget" UX: starting a generation is a commitment;
      // navigating away doesn't waste the work.
      //
      // The AbortController exists only to satisfy the LLM-stream signal
      // parameter — it's never aborted from this route. The server-side
      // timeout inside withTimeout() is the only signal that can cancel
      // the in-flight LLM call.
      const ac = new AbortController();
      let clientClosed = false;

      request.raw.on("close", () => {
        clientClosed = true;
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

        // Detect output-cap truncation. When the model hits maxOutputTokens
        // the stream drains cleanly with `finishReason: "length"` and the
        // document is cut mid-statement — the sanitizer will still find a
        // <!DOCTYPE and happily return the truncated body. Without this
        // check we'd persist broken HTML and charge the user for it.
        const finishReason = await result.finishReason;
        if (finishReason === "length") {
          streamError = new Error(
            "Generation hit the output token limit. The game was cut off mid-way — please try again or simplify the prompt."
          );
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error("Unknown error");
      }

      // Sanitize before persistence. The model occasionally violates the
      // "output ONLY raw HTML" contract by prepending a prose preamble or
      // wrapping in markdown fences; we strip those defensively. Returns
      // null when no <!DOCTYPE / <html opener is found at all — treated
      // as a stream error so credits refund and the game row is left in
      // the "generation failed" state.
      let sanitizedCode: string | null = null;
      if (!streamError) {
        sanitizedCode = sanitizeHtmlOutput(accumulatedCode);
        if (!sanitizedCode) {
          streamError = new Error("Model output contained no recognizable HTML");
          request.log.warn(
            { rawLength: accumulatedCode.length, head: accumulatedCode.slice(0, 200) },
            "generation output rejected by sanitizer"
          );
        }
      }

      // Persist only on success. A mid-stream failure (timeout, output-cap
      // truncation, model error, sanitizer rejection) leaves currentCode
      // as the empty default — the existing "this generation failed"
      // signal — and the user can delete or re-prompt.
      //
      // If the persistence itself fails, treat it as a stream error so we
      // refund credits and surface the failure to the client. Previously
      // this was silently swallowed, leaving the user with empty code,
      // `inProgress=false`, and no error — a confusing dead state.
      if (!streamError && sanitizedCode) {
        try {
          await db
            .update(games)
            .set({ currentCode: sanitizedCode, updatedAt: Date.now() })
            .where(eq(games.id, id));
        } catch (err) {
          streamError = err instanceof Error ? err : new Error("Persistence failed");
          request.log.error(
            { err: streamError.message, gameId: id },
            "failed to persist generated code"
          );
        }
      }

      // Finalize: markSucceeded or refund (mutually exclusive, each runs once).
      // Errors from these calls used to be silently swallowed, which meant a
      // refund failure left the user overcharged with no observability and
      // a markSucceeded failure left the usage_log row indistinguishable from
      // an in-flight stream. Log both so ops can spot drift.
      if (streamError) {
        await refund(logId, {
          logger: request.log,
          reason: classifyRefundReason(streamError),
        }).catch((err) => {
          request.log.error(
            { err: err instanceof Error ? err.message : String(err), logId },
            "credit refund failed; user may be overcharged"
          );
        });
      } else {
        // Success (including user-cancel per SPEC §14: credits not refunded on cancel)
        await markSucceeded(logId).catch((err) => {
          request.log.error(
            { err: err instanceof Error ? err.message : String(err), logId },
            "markSucceeded failed; usage_log row left in in-flight state"
          );
        });
      }

      if (!clientClosed) {
        if (streamError) {
          writeSSE(reply, "error", { message: streamError.message });
        } else {
          writeSSE(reply, "done", {});
        }
        endSSE(reply);
      }
    } catch (err) {
      // Refund any charge first — shared by both branches below. Idempotent,
      // so a pre-hijack path that already refunded is a no-op.
      if (logId) {
        await refund(logId, {
          logger: request.log,
          reason: "persistence_error",
        }).catch((refundErr) => {
          request.log.error(
            { err: refundErr instanceof Error ? refundErr.message : String(refundErr), logId },
            "credit refund failed after handler throw; user may be overcharged"
          );
        });
      }
      // A throw BEFORE reply.hijack() (e.g. the game/message insert
      // transaction, or a non-quota deduct failure) still has a normal
      // Fastify reply: rethrow so the global error handler returns a proper
      // JSON 500 with CORS headers instead of raw SSE frames on an implicit
      // 200 status.
      if (!hijacked) {
        throw err;
      }
      // A throw AFTER reply.hijack() (e.g. the bare genre/title db.update
      // calls in the pre-stream section) bypasses Fastify's error handler,
      // which no longer runs for a hijacked response. Without this catch the
      // user is left charged with no code persisted and the client hangs with
      // no terminator frame. Refund and emit an explicit error + endSSE.
      request.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "generation handler threw after hijack"
      );
      if (!reply.raw.writableEnded) {
        writeSSE(reply, "error", { message: "Generation failed unexpectedly" });
        endSSE(reply);
      }
    } finally {
      stopHeartbeat?.();
      release(userId);
    }
  });

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
    const { previousCode, ...rest } = game;
    return reply.send({
      ...rest,
      canUndo: Boolean(previousCode),
      messages: msgs,
      inProgress: inflight.length > 0,
    });
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
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }
    const { id } = paramsResult.data;
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

  // POST /api/games/:id/undo — single-level undo of the last refinement/repair.
  // Restores previous_code into current_code and clears previous_code, so undo
  // is one step deep by design (no redo, no stack). Idempotent-safe: a second
  // undo with nothing to restore returns 409 rather than corrupting state.
  app.post("/api/games/:id/undo", async (request, reply) => {
    const paramsResult = GameIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      return sendError(reply, 400, validationError("Invalid id"));
    }
    const { id } = paramsResult.data;
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

    // See generation route for the rationale on hoisting stopHeartbeat.
    let stopHeartbeat: (() => void) | null = null;
    // Hoisted so the post-hijack catch can refund against it.
    let logId: string | null = null;
    // See generation route — pre-hijack throws must be rethrown to Fastify,
    // not answered with SSE frames on a non-hijacked reply.
    let hijacked = false;
    try {
      // Deduct credits. Same TOCTOU/refund considerations as POST /api/games.
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

        // Only the most recent feedback turns feed the refinement prompt
        // (buildRefinementContext keeps the last MAX_FEEDBACK_TURNS). Filter to
        // kind='feedback' and LIMIT in SQL instead of loading the whole message
        // history — a heavily-iterated game can have hundreds of rows, and we
        // need at most ~12. Fetch newest-first, then reverse to chronological.
        const RECENT_FEEDBACK_LIMIT = 12;
        const pastRows = await db
          .select({ content: messages.content })
          .from(messages)
          .where(
            and(eq(messages.gameId, id), eq(messages.kind, "feedback"), ne(messages.id, feedbackId))
          )
          .orderBy(desc(messages.createdAt))
          .limit(RECENT_FEEDBACK_LIMIT);

        const pastFeedback = pastRows.map((r) => r.content).reverse();

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
        await refund(logId, { logger: request.log, reason: "persistence_error" }).catch(
          (refundErr) => {
            request.log.error(
              { err: refundErr instanceof Error ? refundErr.message : String(refundErr), logId },
              "credit refund failed during pre-stream setup; user may be overcharged"
            );
          }
        );
        throw err;
      }

      reply.hijack();
      hijacked = true;
      writeSSEHeaders(reply, request);
      writeSSE(reply, "meta", { gameId: id, placeholderTitle: game.title });
      stopHeartbeat = startHeartbeat(reply);

      // Same background-stream semantics as the generation route — closing
      // the tab mid-refinement lets the LLM finish; the new code is
      // persisted and credits are consumed.
      const ac = new AbortController();
      let clientClosed = false;

      request.raw.on("close", () => {
        clientClosed = true;
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

        // Output-cap truncation guard — see generation route comment.
        const finishReason = await result.finishReason;
        if (finishReason === "length") {
          streamError = new Error(
            "Refinement hit the output token limit. The game was cut off mid-way — please try again or simplify the request."
          );
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error("Unknown error");
      }

      // Sanitize before persistence — see generation route comment for
      // the rationale. A bad refinement would otherwise overwrite a
      // working game with a prose-prefixed broken document.
      // Sanitize whenever the stream itself didn't error. An empty stream
      // (zero text deltas, non-`length` finish) must NOT short-circuit to
      // markSucceeded — sanitizeHtmlOutput("") returns null, which we treat
      // as a stream error so credits refund. Previously the `&& accumulatedCode`
      // guard skipped this block on an empty stream, then fell through to
      // markSucceeded and charged the user 150 credits for no persisted code.
      let sanitizedCode: string | null = null;
      if (!streamError) {
        sanitizedCode = sanitizeHtmlOutput(accumulatedCode);
        if (!sanitizedCode) {
          streamError = new Error("Model output contained no recognizable HTML");
          request.log.warn(
            { rawLength: accumulatedCode.length, head: accumulatedCode.slice(0, 200) },
            "refinement output rejected by sanitizer"
          );
        }
      }

      if (!streamError && sanitizedCode) {
        try {
          await db
            .update(games)
            // Snapshot the pre-refinement code into previous_code so the user
            // can undo a bad refinement (single-level). game.currentCode was
            // loaded before the stream, so it's the code as it stood prior.
            .set({
              previousCode: game.currentCode,
              currentCode: sanitizedCode,
              updatedAt: Date.now(),
            })
            .where(eq(games.id, id));
        } catch (err) {
          // Treat persistence failure as a stream error — same rationale as
          // the generation route: refund credits and surface the error to
          // the client instead of leaving an inconsistent partial state.
          streamError = err instanceof Error ? err : new Error("Persistence failed");
          request.log.error(
            { err: streamError.message, gameId: id },
            "failed to persist refined code"
          );
        }
      }

      // Finalize credits. See generation route for rationale on logging
      // both branches instead of silently swallowing.
      if (streamError) {
        await refund(logId, {
          logger: request.log,
          reason: classifyRefundReason(streamError),
        }).catch((err) => {
          request.log.error(
            { err: err instanceof Error ? err.message : String(err), logId },
            "credit refund failed; user may be overcharged"
          );
        });
      } else {
        await markSucceeded(logId).catch((err) => {
          request.log.error(
            { err: err instanceof Error ? err.message : String(err), logId },
            "markSucceeded failed; usage_log row left in in-flight state"
          );
        });
      }

      // Emit `done` immediately so the UI flips out of the streaming
      // state and the user can play the refined game without waiting on
      // the diff summary call. The SSE hook keeps reading after `done`,
      // so the summary event below still reaches the client.
      if (!clientClosed) {
        if (streamError) {
          writeSSE(reply, "error", { message: streamError.message });
        } else {
          writeSSE(reply, "done", {});
        }
      }

      // Diff summary — fire after success only. Generates a 1-2 sentence
      // "what changed" recap on GPT-mini and persists as a `summary`
      // message so the chat panel can render it as an AI-side bubble.
      // Failure is non-fatal; the stream has already succeeded.
      if (!streamError && sanitizedCode && sanitizedCode !== game.currentCode) {
        try {
          const summaryText = await generateDiffSummary({
            feedback,
            previousCode: game.currentCode ?? "",
            newCode: sanitizedCode,
            logger: request.log,
          });
          if (summaryText) {
            const summaryId = randomUUID();
            await db.insert(messages).values({
              id: summaryId,
              gameId: id,
              kind: "summary",
              content: summaryText,
              createdAt: Date.now(),
            });
            if (!clientClosed) {
              writeSSE(reply, "summary", { id: summaryId, content: summaryText });
            }
          }
        } catch {
          // Summary is best-effort; suppress and move on.
        }
      }

      if (!clientClosed) {
        endSSE(reply);
      }
    } catch (err) {
      // Refund any charge first — shared by both branches below. Idempotent,
      // so the pre-stream-setup path (which already refunded) is a no-op.
      if (logId) {
        await refund(logId, {
          logger: request.log,
          reason: "persistence_error",
        }).catch((refundErr) => {
          request.log.error(
            { err: refundErr instanceof Error ? refundErr.message : String(refundErr), logId },
            "credit refund failed after handler throw; user may be overcharged"
          );
        });
      }
      // See generation route: a pre-hijack throw still has a normal Fastify
      // reply — rethrow to the global error handler for a proper JSON 500.
      if (!hijacked) {
        throw err;
      }
      // A throw AFTER reply.hijack() (e.g. startHeartbeat / writeSSEHeaders, or
      // any unforeseen synchronous throw in the stream-setup region) bypasses
      // Fastify's error handler, which no longer runs for a hijacked response.
      // Without this catch the user is left charged with no code persisted and
      // the client hangs with no terminator frame. Mirror the generation route:
      // refund and emit an explicit error + endSSE.
      request.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "refinement handler threw after hijack"
      );
      if (!reply.raw.writableEnded) {
        writeSSE(reply, "error", { message: "Refinement failed unexpectedly" });
        endSSE(reply);
      }
    } finally {
      stopHeartbeat?.();
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

    // Repair requires existing code. Without this guard, a failed initial
    // generation that left currentCode = "" would send the model an empty
    // "Current code:" block, burning tokens to produce a fresh game without
    // RAG context.
    if (!game.currentCode) {
      return sendError(reply, 400, validationError("Game has no code to repair"));
    }

    // Budget check — see REPAIR_DAILY_LIMIT. Runs before the SSE hijack so
    // the client gets a proper JSON 429 instead of an SSE error frame.
    const repairCountRows = await db
      .select({ n: sql<number>`count(*)` })
      .from(usageLog)
      .where(
        and(
          eq(usageLog.userId, userId),
          eq(usageLog.action, "repair"),
          gt(usageLog.createdAt, Date.now() - REPAIR_WINDOW_MS)
        )
      );
    if ((repairCountRows[0]?.n ?? 0) >= REPAIR_DAILY_LIMIT) {
      return sendError(reply, 429, {
        code: "RATE_LIMITED",
        message: "Daily repair limit reached. Please try again later.",
      });
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

    // See generation route for the rationale on hoisting stopHeartbeat.
    let stopHeartbeat: (() => void) | null = null;
    // Hoisted so the post-hijack catch can terminalize the log row.
    let logId: string | null = null;
    try {
      // Open SSE before log insert so the client gets meta promptly
      reply.hijack();
      writeSSEHeaders(reply, request);
      writeSSE(reply, "meta", { gameId: game.id, placeholderTitle: game.title });
      stopHeartbeat = startHeartbeat(reply);

      // Insert observability row (credits_charged=0 per SPEC §10).
      // Wrapped so a DB hiccup here doesn't leave the client with a meta
      // event and no follow-up — write an error frame, end the stream,
      // and bail. The repair is free so there are no credits to refund.
      try {
        ({ logId } = await logRepair(userId, game.id));
      } catch (err) {
        request.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "repair logRepair failed"
        );
        writeSSE(reply, "error", { message: "Failed to start repair" });
        endSSE(reply);
        return;
      }

      // Categorize error (soft-fail per plan §3)
      const { category } = await categorizeError(gameError, request.log);

      const userMessage = buildRepairUserMessage({
        originalPrompt: game.originalPrompt ?? "",
        category,
        message: gameError.message,
        stack: gameError.stack,
        code: game.currentCode,
      });

      // Same background-stream semantics as the generation route — closing
      // the tab mid-repair lets the LLM finish; the repaired code is
      // persisted. Repair is credit-free so there's no charge to consider.
      const ac = new AbortController();
      let clientClosed = false;
      request.raw.on("close", () => {
        clientClosed = true;
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

        // Output-cap truncation guard — see generation route comment.
        const finishReason = await result.finishReason;
        if (finishReason === "length") {
          streamError = new Error(
            "Repair hit the output token limit. Please try again or simplify the game first."
          );
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error("Unknown error");
      }

      // Sanitize before persistence — see generation route comment for
      // the rationale. This was the failure mode that prompted the
      // helper: a repair returned an explanatory paragraph followed by
      // the HTML, and saving the prose preamble verbatim broke the
      // game until a manual SQL fix.
      // Sanitize on !streamError alone (not `&& accumulated`) to converge with
      // the generation/refine handlers: an empty repair stream yields
      // sanitizeHtmlOutput("") === null, which sets streamError so we emit an
      // error frame instead of marking a no-op repair as succeeded. Repair is
      // credit-free so this is observability, not an overcharge.
      let sanitizedRepair: string | null = null;
      if (!streamError) {
        sanitizedRepair = sanitizeHtmlOutput(accumulated);
        if (!sanitizedRepair) {
          streamError = new Error("Model output contained no recognizable HTML");
          request.log.warn(
            { rawLength: accumulated.length, head: accumulated.slice(0, 200) },
            "repair output rejected by sanitizer"
          );
        }
      }

      if (!streamError && sanitizedRepair) {
        // Persist repaired code. Repair is free so there's no credit to
        // refund — but if the write fails we still want to flip the
        // log row to surface the failure (no markRepairSucceeded) and
        // signal the client via an error frame.
        try {
          await db
            .update(games)
            // Snapshot pre-repair code for single-level undo, mirroring refine.
            .set({
              previousCode: game.currentCode,
              currentCode: sanitizedRepair,
              updatedAt: Date.now(),
            })
            .where(eq(games.id, id));
        } catch (err) {
          streamError = err instanceof Error ? err : new Error("Persistence failed");
          request.log.error(
            { err: streamError.message, gameId: id },
            "failed to persist repaired code"
          );
        }
      }
      if (!streamError) {
        await markRepairSucceeded(logId).catch((err) => {
          request.log.error(
            { err: err instanceof Error ? err.message : String(err), logId },
            "markRepairSucceeded failed; repair_log row left in in-flight state"
          );
        });
      } else {
        // Terminalize the row on failure too. Leaving it succeeded=0 with
        // refunded_at NULL made the undo route's in-flight guard treat the
        // failed repair as an active stream forever — one failed repair
        // permanently 409'd every subsequent undo for the game.
        await markRepairFailed(logId).catch((err) => {
          request.log.error(
            { err: err instanceof Error ? err.message : String(err), logId },
            "markRepairFailed failed; repair log row left in in-flight state"
          );
        });
      }

      if (!clientClosed) {
        if (streamError) {
          writeSSE(reply, "error", { message: streamError.message });
        } else {
          writeSSE(reply, "done", {});
        }
        endSSE(reply);
      }
    } catch (err) {
      // A throw AFTER reply.hijack() (e.g. buildRepairUserMessage on
      // pathological input) bypasses Fastify's error handler. Repair is
      // credit-free so there's nothing to refund, but the client must still
      // get a terminator frame instead of a hung stream.
      request.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "repair handler threw after hijack"
      );
      if (logId) {
        // Same terminalization as the in-band failure path — see comment there.
        await markRepairFailed(logId).catch((markErr) => {
          request.log.error(
            { err: markErr instanceof Error ? markErr.message : String(markErr), logId },
            "markRepairFailed failed after post-hijack throw"
          );
        });
      }
      if (!reply.raw.writableEnded) {
        writeSSE(reply, "error", { message: "Repair failed unexpectedly" });
        endSSE(reply);
      }
    } finally {
      stopHeartbeat?.();
      release(userId);
    }
  });
}
