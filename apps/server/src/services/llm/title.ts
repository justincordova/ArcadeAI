import { openai } from "@ai-sdk/openai";
import { GPT_MINI, computeCost } from "@arcadeai/shared/models.js";
import { generateText } from "ai";
import type { FastifyBaseLogger } from "fastify";

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
  return text.trim().slice(0, 80);
}
