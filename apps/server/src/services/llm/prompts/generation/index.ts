import type { GenreBucket } from "@arcadeai/shared/genres.js";
import { BASE_GENERATION_CONTRACT } from "../base.js";
import { flappy } from "./flappy.js";
import { other } from "./other.js";
import { paddle } from "./paddle.js";
import { platformer } from "./platformer.js";
import { puzzle } from "./puzzle.js";
import { runner } from "./runner.js";
import { shooter } from "./shooter.js";
import { snake } from "./snake.js";

const VARIANTS: Record<GenreBucket, string> = {
  paddle,
  snake,
  flappy,
  shooter,
  platformer,
  puzzle,
  runner,
  other,
};

const RAG_FRAMING =
  "Reference example — build something in this style. Match its structural pattern (init/update/render/gameLoop, title screen, key state map, procedural assets, self-contained single file). Do NOT copy its game mechanics; produce the game described by the user prompt.";

/**
 * Format a RAG example block for injection into the system prompt.
 * Reused from the step-9 few-shot wrapper pattern.
 */
export function formatExampleBlock(example: string): string {
  return `---\n\n${RAG_FRAMING}\n\n${example}`;
}

/**
 * Build the full generation system prompt for a classified prompt.
 * Composes: base contract + genre variant + (optional) RAG example + style guidance.
 */
export function buildGenerationSystemPrompt(args: {
  genre: GenreBucket;
  styleTags: string[];
  example: string | null;
}): string {
  const parts = [BASE_GENERATION_CONTRACT, VARIANTS[args.genre]];
  if (args.example) parts.push(formatExampleBlock(args.example));
  if (args.styleTags.length > 0) {
    parts.push(`Style guidance: ${args.styleTags.join(", ")}`);
  }
  return parts.filter(Boolean).join("\n\n");
}
