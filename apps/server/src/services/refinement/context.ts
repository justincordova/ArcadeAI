import { REFINEMENT_SYSTEM_PROMPT } from "../llm/prompts/refinement.js";
import { summarizeCode } from "../llm/summarize.js";

interface RefinementContextInput {
  game: {
    currentCode: string;
    originalPrompt: string;
  };
  feedback: string;
  pastFeedback: string[];
}

interface RefinementContext {
  system: string;
  prompt: string;
}

export async function buildRefinementContext({
  game,
  feedback,
  pastFeedback,
}: RefinementContextInput): Promise<RefinementContext> {
  // Decide whether to use full code or a summarized digest
  const estimatedTokens = game.currentCode.length / 4;
  const codeOrDigest =
    estimatedTokens > 2000 ? await summarizeCode(game.currentCode) : game.currentCode;

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
