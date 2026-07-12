import { openai } from "@ai-sdk/openai";
import { computeCost, GPT_MINI } from "@arcadeai/shared/models.js";
import { generateText } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { AUX_LLM_TIMEOUT_MS } from "./client.js";

const SYSTEM =
  "Generate a concise, descriptive game title for the user's prompt. Return only the title — no quotes, no punctuation, no preamble. Maximum 80 characters.";

/**
 * Generate a short title for a game prompt. No internal try/catch — the
 * caller wraps in Promise.allSettled so a rejection keeps the placeholder
 * title (SPEC §7 / §19 step 10).
 */
export async function generateTitle(prompt: string, logger?: FastifyBaseLogger): Promise<string> {
  const start = Date.now();
  const { text, usage } = await generateText({
    model: openai(GPT_MINI),
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    // Awaited in the pre-generation fanout — a hang must settle so
    // Promise.allSettled can fall back to the placeholder title.
    abortSignal: AbortSignal.timeout(AUX_LLM_TIMEOUT_MS),
  });
  logger?.info(
    {
      model: GPT_MINI,
      tokens_in: usage.inputTokens,
      tokens_out: usage.outputTokens,
      duration_ms: Date.now() - start,
      cost_usd: computeCost({ model: GPT_MINI, usage }),
    },
    "llm call"
  );
  const title = text.trim().slice(0, 80);
  // Treat an empty/whitespace-only result as a failure so Promise.allSettled
  // keeps the meaningful placeholder (prompt.slice(0,40)) instead of
  // overwriting the row with "". An empty title would blank the dashboard /
  // discover cards and produce an empty <title> / og:title on the play page.
  if (!title) throw new Error("model returned an empty title");
  return title;
}
