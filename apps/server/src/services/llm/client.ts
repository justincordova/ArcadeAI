import { createAnthropic } from "@ai-sdk/anthropic";
import { SONNET, computeCost } from "@arcadeai/shared";
import { streamText } from "ai";
import type { FastifyBaseLogger } from "fastify";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

// Server-side LLM timeouts. Sized to accommodate the maxOutputTokens
// ceiling on each call: at ~80 output tok/sec, 16K tokens needs ~200s
// in the worst case, so all three get 180s.
//
// The timeout is composed with the user's AbortController via
// AbortSignal.any so a user cancel still aborts immediately.
export const LLM_TIMEOUT_MS = {
  generation: 180_000,
  refinement: 180_000,
  repair: 180_000,
} as const;

// Per-call output ceilings. The 8192 default truncated mid-stream on
// non-trivial games (e.g. ~19K-char dance/parkour titles ran out mid-
// statement, leaving the iframe with unparseable JS and a blank canvas).
// Sonnet 4.6 supports up to 64K output tokens; 16K covers ~50K chars of
// HTML/JS — plenty for any reasonable game without inviting runaway
// generations.
//
// Repair was previously 8192 on the theory that repairs should be
// targeted patches, but in practice the prompt requires the model to
// output the entire file again (no diff format). For a 15K-char game
// that's ~5K tokens — most of the 8K cap is consumed before the
// repaired body even starts, and the model frequently truncated mid-
// statement, leaving worse code than it started with. Match generation
// at 16K.
const MAX_OUTPUT_TOKENS = {
  generation: 16_000,
  refinement: 16_000,
  repair: 16_000,
} as const;

/**
 * Compose the user's abort signal with a server-side timeout. Returns the
 * combined signal AND a cleanup function the caller MUST invoke after the
 * stream resolves so the timer doesn't leak.
 */
export function withTimeout(
  userSignal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const timeoutController = new AbortController();
  const handle = setTimeout(() => {
    timeoutController.abort(new Error("LLM call exceeded server-side timeout"));
  }, timeoutMs);

  // AbortSignal.any composes multiple signals; aborts when any input aborts.
  // Available since Node 20 / Bun 1.0.
  const composed = AbortSignal.any([userSignal, timeoutController.signal]);

  return {
    signal: composed,
    cleanup: () => clearTimeout(handle),
  };
}

export async function streamGame({
  system,
  prompt,
  signal,
  logger,
}: {
  system: string;
  prompt: string;
  signal: AbortSignal;
  logger?: FastifyBaseLogger;
}) {
  const start = Date.now();
  const { signal: composed, cleanup } = withTimeout(signal, LLM_TIMEOUT_MS.generation);
  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: anthropic(SONNET),
      system,
      messages: [{ role: "user", content: prompt }],
      abortSignal: composed,
      maxOutputTokens: MAX_OUTPUT_TOKENS.generation,
    });
  } catch (err) {
    // streamText threw synchronously (e.g. provider misconfig) before the
    // usage-settle cleanup could be wired up — clear the timer so it doesn't
    // leak and fire 180s later against a dead controller.
    cleanup();
    throw err;
  }
  // Cleanup the timer once usage settles (success or error).
  void Promise.resolve(result.usage)
    .then(() => cleanup())
    .catch(() => cleanup());
  logUsageOnDrain(result.usage, start, logger);
  return result;
}

export async function streamRefinement({
  system,
  prompt,
  signal,
  logger,
}: {
  system: string;
  prompt: string;
  signal: AbortSignal;
  logger?: FastifyBaseLogger;
}) {
  const start = Date.now();
  const { signal: composed, cleanup } = withTimeout(signal, LLM_TIMEOUT_MS.refinement);
  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: anthropic(SONNET),
      system,
      messages: [{ role: "user", content: prompt }],
      abortSignal: composed,
      maxOutputTokens: MAX_OUTPUT_TOKENS.refinement,
    });
  } catch (err) {
    cleanup();
    throw err;
  }
  void Promise.resolve(result.usage)
    .then(() => cleanup())
    .catch(() => cleanup());
  logUsageOnDrain(result.usage, start, logger);
  return result;
}

export async function streamRepair({
  system,
  userMessage,
  signal,
  logger,
}: {
  system: string;
  userMessage: string;
  signal: AbortSignal;
  logger?: FastifyBaseLogger;
}) {
  const start = Date.now();
  const { signal: composed, cleanup } = withTimeout(signal, LLM_TIMEOUT_MS.repair);
  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: anthropic(SONNET),
      system,
      messages: [{ role: "user", content: userMessage }],
      abortSignal: composed,
      maxOutputTokens: MAX_OUTPUT_TOKENS.repair,
    });
  } catch (err) {
    cleanup();
    throw err;
  }
  void Promise.resolve(result.usage)
    .then(() => cleanup())
    .catch(() => cleanup());
  logUsageOnDrain(result.usage, start, logger);
  return result;
}

// Emit the structured `llm call` INFO line after the stream drains.
// Per plan §5: skip the line on stream error rather than logging zeros.
// The `.catch` is critical — without it, an aborted or failed stream
// produces an unhandled promise rejection that can crash the process.
//
// The `logger` param is the request-scoped child logger from
// plugins/request-context.ts, which has `requestId` and `userId` already
// bound. That means the emitted line carries `userId` for free — every cost
// log can be aggregated by user without changes here.
function logUsageOnDrain(
  usagePromise: PromiseLike<{ inputTokens?: number; outputTokens?: number }>,
  start: number,
  logger: FastifyBaseLogger | undefined
) {
  Promise.resolve(usagePromise)
    .then((usage) => {
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      logger?.info(
        {
          model: SONNET,
          tokens_in: inputTokens,
          tokens_out: outputTokens,
          duration_ms: Date.now() - start,
          cost_usd: computeCost({
            model: SONNET,
            usage: { inputTokens, outputTokens },
          }),
        },
        "llm call"
      );
    })
    .catch(() => {
      // Stream errored or was aborted before usage resolved. The route
      // handler logs the failure separately via setErrorHandler / refund.
    });
}

/**
 * Whether an LLM error looks like an auth/config failure (invalid or revoked
 * API key, forbidden) rather than a transient/per-request issue (rate limit,
 * timeout, 5xx). The soft-fail helpers (classify/title/summarize/etc.) degrade
 * silently on ANY error — which is correct per SPEC §6, but means a dead API
 * key degrades the whole product to defaults with no alerting. Callers use this
 * to log auth failures at ERROR (a 100%-of-requests config fault ops must see)
 * while keeping transient failures at WARN.
 */
export function isLlmAuthError(err: unknown): boolean {
  // The AI SDK surfaces HTTP status on APICallError-shaped errors; fall back to
  // a message sniff for wrappers that don't.
  const status =
    (err as { statusCode?: number; status?: number } | null)?.statusCode ??
    (err as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return true;
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("invalid api key") ||
    msg.includes("incorrect api key") ||
    msg.includes("authentication") ||
    msg.includes("unauthorized")
  );
}
