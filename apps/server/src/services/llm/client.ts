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
  // Log after stream drains (usage is populated only after full drain in caller)
  void result.usage.then((usage) => {
    logger?.info(
      {
        model: SONNET,
        tokens_in: usage.inputTokens,
        tokens_out: usage.outputTokens,
        duration_ms: Date.now() - start,
        cost_usd: computeCost({ model: SONNET, usage }),
      },
      "llm call"
    );
  });
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
  void result.usage.then((usage) => {
    logger?.info(
      {
        model: SONNET,
        tokens_in: usage.inputTokens,
        tokens_out: usage.outputTokens,
        duration_ms: Date.now() - start,
        cost_usd: computeCost({ model: SONNET, usage }),
      },
      "llm call"
    );
  });
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
  void result.usage.then((usage) => {
    logger?.info(
      {
        model: SONNET,
        tokens_in: usage.inputTokens,
        tokens_out: usage.outputTokens,
        duration_ms: Date.now() - start,
        cost_usd: computeCost({ model: SONNET, usage }),
      },
      "llm call"
    );
  });
  return result;
}
