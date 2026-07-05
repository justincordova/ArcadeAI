import { createOpenAI } from "@ai-sdk/openai";
import { GPT_MINI, computeCost } from "@arcadeai/shared";
import { generateText } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { AUX_LLM_TIMEOUT_MS } from "./client.js";

// Lazily construct the OpenAI client so a missing OPENAI_API_KEY surfaces a
// clear error at the call site instead of silently constructing a client
// with apiKey: undefined that 401s on first use. Mirrors embed.ts.
let cachedClient: ReturnType<typeof createOpenAI> | null = null;
function getOpenAI() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for code summarization. Set it in .env.");
  }
  cachedClient = createOpenAI({ apiKey });
  return cachedClient;
}

const SUMMARIZE_SYSTEM_PROMPT =
  "Summarize this single-file HTML game into a structural digest for another model that will rewrite parts of it. Include: function signatures (name + params), top-level constants and their roles, brief outline of the main game loop and state machine. Do NOT reproduce the full code. Be terse.";

export async function summarizeCode(html: string, logger?: FastifyBaseLogger): Promise<string> {
  const start = Date.now();
  const { text, usage } = await generateText({
    model: getOpenAI()(GPT_MINI),
    system: SUMMARIZE_SYSTEM_PROMPT,
    prompt: html,
    // Awaited inside refinement context building, AFTER credits are
    // deducted and while the per-user stream lock is held — a hang here
    // would wedge the user's refinement indefinitely.
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
  return text;
}
