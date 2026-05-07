import { openai } from "@ai-sdk/openai";
import { GPT_MINI } from "@arcadeai/shared/models.js";
import { generateObject } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";

const Schema = z.object({
  category: z.enum(["syntax", "runtime", "logic"]),
});

const SYSTEM =
  "Classify the JavaScript runtime error into one of these categories: syntax (code could not be parsed or has a SyntaxError), runtime (code ran but threw an unexpected exception), logic (code runs without throwing but produces wrong behavior). Pick 'runtime' if unsure.";

/**
 * Categorize a game runtime error using GPT-4.1-mini.
 * Never throws — returns { category: 'runtime' } on any failure per SPEC §6
 * (SPEC §3: classification failure must not block the repair pipeline).
 */
export async function categorizeError(
  args: { message: string; stack?: string },
  logger?: FastifyBaseLogger
): Promise<{ category: "syntax" | "runtime" | "logic" }> {
  const prompt = `Error message: "${args.message}"\nStack trace: ${args.stack ?? "(none provided)"}`;
  try {
    const { object } = await generateObject({
      model: openai(GPT_MINI),
      schema: Schema,
      system: SYSTEM,
      prompt,
    });
    return { category: object.category };
  } catch (err) {
    logger?.warn({ err, raw: args.message }, "category classify failed; defaulting to runtime");
    return { category: "runtime" };
  }
}
