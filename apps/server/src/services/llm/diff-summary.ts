// Generate a 1-2 sentence "what changed" summary after a refinement turn.
// Runs on GPT-4.1-mini, fire-and-forget — failure here never blocks the
// streaming response or refunds credits. The summary is persisted as a
// `summary` message and rendered in the chat panel as an AI-side bubble.
//
// Cost: small (post-refinement, code is already large but capped by the
// model). Soft-fail: returns null on any error so callers can skip
// persistence cleanly.

import { createOpenAI } from "@ai-sdk/openai";
import { GPT_MINI, computeCost } from "@arcadeai/shared";
import { generateText } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { isLlmAuthError } from "./client.js";

const DIFF_SUMMARY_SYSTEM_PROMPT = `You compare two versions of a single-file HTML5 game and describe what the user-visible change accomplished.

Output rules:
- 1-2 sentences. Plain text, no markdown, no code fences, no quotes.
- Speak in past tense, third person. ("Increased ball speed and added a wall-bounce sound.")
- Focus on gameplay-visible changes. Skip refactors, comment edits, and reformatting.
- Do not include line numbers, function names, or code identifiers unless the user-visible meaning requires it.
- If you cannot identify a meaningful change, output exactly: No visible changes.`;

interface DiffSummaryInput {
  feedback: string;
  previousCode: string;
  newCode: string;
  logger?: FastifyBaseLogger;
}

// Cap each side at ~32KB so a giant game doesn't blow up the context.
// Past this length, GPT-mini will still see the start + end of each file
// which is where most diffs land. (Generated games are typically 8-20KB.)
const MAX_CODE_CHARS = 32_000;

function clipCode(code: string): string {
  if (code.length <= MAX_CODE_CHARS) return code;
  const half = Math.floor(MAX_CODE_CHARS / 2);
  return `${code.slice(0, half)}\n/* ... ${code.length - MAX_CODE_CHARS} chars elided ... */\n${code.slice(-half)}`;
}

export async function generateDiffSummary({
  feedback,
  previousCode,
  newCode,
  logger,
}: DiffSummaryInput): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userMessage = `User feedback: ${feedback}

PREVIOUS VERSION:
\`\`\`html
${clipCode(previousCode)}
\`\`\`

NEW VERSION:
\`\`\`html
${clipCode(newCode)}
\`\`\``;

  const start = Date.now();
  try {
    const { text, usage } = await generateText({
      model: openai(GPT_MINI),
      system: DIFF_SUMMARY_SYSTEM_PROMPT,
      prompt: userMessage,
    });
    logger?.info(
      {
        model: GPT_MINI,
        tokens_in: usage.inputTokens,
        tokens_out: usage.outputTokens,
        duration_ms: Date.now() - start,
        cost_usd: computeCost({ model: GPT_MINI, usage }),
        op: "diff-summary",
      },
      "llm call"
    );
    const trimmed = text.trim();
    if (!trimmed || trimmed === "No visible changes.") return null;
    return trimmed;
  } catch (err) {
    if (isLlmAuthError(err)) {
      logger?.error({ err }, "diff-summary failed: LLM auth/config error");
    } else {
      logger?.warn({ err }, "diff-summary failed");
    }
    return null;
  }
}
