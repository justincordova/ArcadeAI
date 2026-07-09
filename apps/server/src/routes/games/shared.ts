// Shared building blocks for the game route modules (crud-routes,
// streaming-routes): request schemas, tuning constants, the per-user stream
// rate-limit config, and the refund-reason classifier. Split out so the two
// route groups can be registered from separate files without duplicating
// these definitions.
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sendError, validationError } from "../../lib/errors.js";
import type { RefundReason } from "../../services/usage/charge.js";

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
export function classifyRefundReason(err: Error): RefundReason {
  const msg = err.message.toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
  if (err.name === "AbortError") return "abort";
  return "llm_error";
}

export const CreateGameBody = z.object({
  prompt: z.string().trim().min(1).max(2000),
});

// Not exported — only parseGameId (below) consumes it.
const GameIdParams = z.object({
  id: z.string().min(1),
});

/**
 * Validate the `:id` route param and return it, or send a 400 and return
 * null. Callers must early-return on null: `const id = parseGameId(...); if
 * (!id) return;`. Consolidates the identical safeParse block that every
 * game route repeated.
 */
export function parseGameId(request: FastifyRequest, reply: FastifyReply): string | null {
  const result = GameIdParams.safeParse(request.params);
  if (!result.success) {
    sendError(reply, 400, validationError("Invalid id"));
    return null;
  }
  return result.data.id;
}

export const PatchGameBody = z.object({
  title: z.string().trim().min(1).max(80),
});

export const ThumbnailBody = z.object({
  thumbnail: z.string().startsWith("data:image/png;base64,").max(350_000),
});

export const RefineBody = z.object({
  feedback: z.string().trim().min(1).max(2000),
});

export const RepairBody = z.object({
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
export const STALE_STREAM_CUTOFF_MS = 15 * 60_000;

// Rolling 24h cap on repair attempts per user. Repairs are credit-free per
// SPEC §10 and exempt from the lifetime caps, which makes them the ONLY
// full-Claude-stream endpoint with no cost control: a user (including a
// free-tier account that exhausted its lifetime caps) could fabricate
// error payloads and drive 10 streams/min indefinitely at zero credit
// cost. The client's auto-repair fires at most 2 attempts per error, so a
// generous budget never touches legitimate use while bounding worst-case
// spend. Checked as a plain count — a small racy overshoot is acceptable
// for a budget (unlike the atomic credit guards).
export const REPAIR_DAILY_LIMIT = 50;
export const REPAIR_WINDOW_MS = 24 * 3600_000;

// Per-user rate limit for streaming endpoints: 10 req/min (SPEC §14).
// Override the global `onRequest` hook with `preHandler` so the
// keyGenerator runs AFTER the auth preHandler has populated
// `request.authSession`. Without this, the keyGenerator falls back to
// `req.ip` for every authenticated request, defeating per-user keying.
export const perUser10PerMin = {
  rateLimit: {
    max: 10,
    timeWindow: "1 minute",
    hook: "preHandler" as const,
    keyGenerator: (req: FastifyRequest) =>
      (req as FastifyRequest & { authSession?: { user?: { id?: string } } }).authSession?.user
        ?.id ?? req.ip,
  },
};
