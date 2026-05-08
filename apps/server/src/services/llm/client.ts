import { createAnthropic } from "@ai-sdk/anthropic";
import { SONNET, computeCost } from "@arcadeai/shared";
import { streamText } from "ai";
import type { FastifyBaseLogger } from "fastify";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

// Server-side LLM timeouts. Generation and refinement get 90s — enough
// for a slow-but-healthy Anthropic response on a cold model. Repair gets
// 60s because output is shorter and we don't want a stuck repair to block
// the user's next attempt.
//
// The timeout is composed with the user's AbortController via
// AbortSignal.any so a user cancel still aborts immediately.
export const LLM_TIMEOUT_MS = {
  generation: 90_000,
  refinement: 90_000,
  repair: 60_000,
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
  const result = streamText({
    model: anthropic(SONNET),
    system,
    messages: [{ role: "user", content: prompt }],
    abortSignal: composed,
    maxOutputTokens: 8192,
  });
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
  const result = streamText({
    model: anthropic(SONNET),
    system,
    messages: [{ role: "user", content: prompt }],
    abortSignal: composed,
    maxOutputTokens: 8192,
  });
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
  const result = streamText({
    model: anthropic(SONNET),
    system,
    messages: [{ role: "user", content: userMessage }],
    abortSignal: composed,
    maxOutputTokens: 8192,
  });
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
