import { createOpenAI } from "@ai-sdk/openai";
import { EMBEDDING } from "@arcadeai/shared";
import { embed } from "ai";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });

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
