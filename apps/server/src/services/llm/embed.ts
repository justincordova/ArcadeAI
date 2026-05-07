import { createOpenAI } from "@ai-sdk/openai";
import { EMBEDDING } from "@arcadeai/shared";
import { embed } from "ai";

// Fail-fast at module load if the embedding provider is misconfigured —
// otherwise a missing key silently disables RAG retrieval on every request
// (the route's `.catch(→null)` graceful-degrade hides the configuration
// bug behind a per-request WARN).
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY is required for RAG embedding (services/llm/embed.ts). " +
      "Set it in .env or unset RAG features explicitly."
  );
}
const openai = createOpenAI({ apiKey });

/**
 * Embed a runtime prompt with text-embedding-3-small for RAG retrieval
 * (SPEC §3, §8). Returns a 1536-dim vector. Throws on API failure — the
 * route is expected to catch and degrade gracefully (retrieval falls back
 * to no few-shot when the embedding is unavailable).
 */
export async function embedPrompt(prompt: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING),
    value: prompt,
  });
  return embedding;
}
