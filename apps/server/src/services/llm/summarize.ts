import { createOpenAI } from "@ai-sdk/openai";
import { GPT_MINI, computeCost } from "@arcadeai/shared";
import { generateText } from "ai";
import type { FastifyBaseLogger } from "fastify";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SUMMARIZE_SYSTEM_PROMPT =
  "Summarize this single-file HTML game into a structural digest for another model that will rewrite parts of it. Include: function signatures (name + params), top-level constants and their roles, brief outline of the main game loop and state machine. Do NOT reproduce the full code. Be terse.";

export async function summarizeCode(html: string, logger?: FastifyBaseLogger): Promise<string> {
  const start = Date.now();
  const { text, usage } = await generateText({
    model: openai(GPT_MINI),
    system: SUMMARIZE_SYSTEM_PROMPT,
    prompt: html,
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
  return text;
}
