import { createOpenAI } from "@ai-sdk/openai";
import { EMBEDDING, computeCost } from "@arcadeai/shared";
import { embed } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { AUX_LLM_TIMEOUT_MS } from "./client.js";

// Lazily construct the OpenAI client so a missing OPENAI_API_KEY only
// breaks the RAG retrieval path instead of crashing server startup.
// Auth, sign-in, and the dashboard all work without an OpenAI key.
let cachedClient: ReturnType<typeof createOpenAI> | null = null;
function getOpenAI() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for RAG embedding. Set it in .env to enable retrieval."
    );
  }
  cachedClient = createOpenAI({ apiKey });
  return cachedClient;
}

/**
 * Embed a runtime prompt with text-embedding-3-small for RAG retrieval
 * (SPEC §3, §8). Returns a 1536-dim vector. Throws on API failure — the
 * route is expected to catch and degrade gracefully (retrieval falls back
 * to no few-shot when the embedding is unavailable).
 */
export async function embedPrompt(prompt: string, logger?: FastifyBaseLogger): Promise<number[]> {
  const start = Date.now();
  const { embedding, usage } = await embed({
    model: getOpenAI().embedding(EMBEDDING),
    value: prompt,
    // Awaited before generation starts — a hung socket must eventually
    // reject so the route's allSettled fanout can degrade to no-RAG.
    abortSignal: AbortSignal.timeout(AUX_LLM_TIMEOUT_MS),
  });
  logger?.info(
    {
      model: EMBEDDING,
      tokens_in: usage.tokens,
      tokens_out: 0,
      duration_ms: Date.now() - start,
      cost_usd: computeCost({
        model: EMBEDDING,
        usage: { inputTokens: usage.tokens, outputTokens: 0 },
      }),
    },
    "llm call"
  );
  return embedding;
}
