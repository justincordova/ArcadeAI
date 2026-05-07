import { createAnthropic } from "@ai-sdk/anthropic";
import { SONNET, computeCost } from "@arcadeai/shared";
import { streamText } from "ai";
import type { FastifyBaseLogger } from "fastify";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

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
  const result = streamText({
    model: anthropic(SONNET),
    system,
    messages: [{ role: "user", content: prompt }],
    abortSignal: signal,
    maxOutputTokens: 8192,
  });
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
  const result = streamText({
    model: anthropic(SONNET),
    system,
    messages: [{ role: "user", content: prompt }],
    abortSignal: signal,
    maxOutputTokens: 8192,
  });
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
  const result = streamText({
    model: anthropic(SONNET),
    system,
    messages: [{ role: "user", content: userMessage }],
    abortSignal: signal,
    maxOutputTokens: 8192,
  });
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
