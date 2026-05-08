import { countTokens } from "@anthropic-ai/tokenizer";
import type { FastifyBaseLogger } from "fastify";
import { REFINEMENT_SYSTEM_PROMPT } from "../llm/prompts/refinement.js";
import { summarizeCode } from "../llm/summarize.js";

interface RefinementContextInput {
  game: {
    currentCode: string;
    originalPrompt: string;
  };
  feedback: string;
  pastFeedback: string[];
  logger?: FastifyBaseLogger;
}

interface RefinementContext {
  system: string;
  prompt: string;
}

// Anything above this many tokens of game code triggers summarization to keep
// the refinement prompt within Claude's working context comfortably.
const SUMMARIZATION_THRESHOLD_TOKENS = 2000;

export async function buildRefinementContext({
  game,
  feedback,
  pastFeedback,
  logger,
}: RefinementContextInput): Promise<RefinementContext> {
  // Use the real Claude tokenizer instead of a `length / 4` estimate. The
  // estimate runs ~30% off for HTML+JS-heavy code and was occasionally
  // sending oversized prompts that the model handled but charged extra for.
  const codeTokens = countTokens(game.currentCode);
  const codeOrDigest =
    codeTokens > SUMMARIZATION_THRESHOLD_TOKENS
      ? await summarizeCode(game.currentCode, logger)
      : game.currentCode;

  const parts: string[] = [];

  parts.push(`Original prompt: "${game.originalPrompt}"`);

  if (pastFeedback.length > 0) {
    parts.push(`Past changes requested:\n${pastFeedback.map((f) => `- "${f}"`).join("\n")}`);
  }

  parts.push(`Current code:\n${codeOrDigest}`);
  parts.push(`Current request: "${feedback}"`);

  return {
    system: REFINEMENT_SYSTEM_PROMPT,
    prompt: parts.join("\n\n"),
  };
}
