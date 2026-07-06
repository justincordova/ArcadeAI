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

// Anything above this many tokens of game code triggers summarization. The
// previous 2000-token threshold tripped on every successful generation
// (typical games are 6-10 KB ≈ 2.5-4K tokens), forcing Claude to refine a
// structural digest instead of the real code — both costly and quality-
// degrading. Sonnet 4.6 has a 1M-token context window, so 16K is generous
// without risking truncation. Summarization only matters as a guardrail for
// pathologically large games (e.g. 60K+ tokens after many refinements).
const SUMMARIZATION_THRESHOLD_TOKENS = 16000;

// Cap how many prior feedback entries we replay into the prompt. Paid users
// have no refinement-count cap, so without this the "Past changes requested"
// block grows without bound — every turn re-sends all prior feedback verbatim,
// inflating token cost monotonically over a long-lived game (and the
// summarization guard above only measures the code, never this block). The
// most recent turns carry the most relevant intent; older ones are already
// reflected in currentCode. Keep the latest N.
const MAX_FEEDBACK_TURNS = 12;

export async function buildRefinementContext({
  game,
  feedback,
  pastFeedback,
  logger,
}: RefinementContextInput): Promise<RefinementContext> {
  // Only run the (synchronous, CPU-bound, event-loop-blocking) Claude
  // tokenizer when the code is long enough to *possibly* exceed the threshold.
  // BPE never produces more tokens than characters, and for HTML+JS the ratio
  // is well above ~3 chars/token, so anything under threshold*3 chars is
  // provably under the token threshold — skip tokenization entirely for the
  // common 8-20 KB game. We still use the real tokenizer (not a length/4
  // estimate) for the borderline-large cases where precision matters.
  const MIN_CHARS_TO_TOKENIZE = SUMMARIZATION_THRESHOLD_TOKENS * 3;
  let codeOrDigest = game.currentCode;
  if (
    game.currentCode.length > MIN_CHARS_TO_TOKENIZE &&
    countTokens(game.currentCode) > SUMMARIZATION_THRESHOLD_TOKENS
  ) {
    // Soft-fail the summarizer: it runs AFTER credits are deducted and while
    // the per-user stream lock is held, so a thrown error (timeout, 5xx,
    // missing OPENAI_API_KEY) would otherwise propagate to the refine route's
    // pre-stream catch and fail the whole refinement. Summarization is an
    // optimization, not a requirement — a too-large prompt is the lesser
    // evil than a failed turn.
    let digest = "";
    try {
      digest = await summarizeCode(game.currentCode, logger);
    } catch (err) {
      logger?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "summarizeCode failed; falling back to full code in refinement context"
      );
    }
    // Fall back to the real code if the summarizer returns an empty digest —
    // feeding Claude an empty "Current code" block would have it refine from
    // nothing and overwrite a working game.
    codeOrDigest = digest.trim() ? digest : game.currentCode;
  }

  const parts: string[] = [];

  parts.push(`Original prompt: "${game.originalPrompt}"`);

  if (pastFeedback.length > 0) {
    const recent = pastFeedback.slice(-MAX_FEEDBACK_TURNS);
    parts.push(`Past changes requested:\n${recent.map((f) => `- "${f}"`).join("\n")}`);
  }

  parts.push(`Current code:\n${codeOrDigest}`);
  parts.push(`Current request: "${feedback}"`);

  return {
    system: REFINEMENT_SYSTEM_PROMPT,
    prompt: parts.join("\n\n"),
  };
}
