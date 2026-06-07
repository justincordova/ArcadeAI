import { openai } from "@ai-sdk/openai";
import { GPT_MINI, computeCost } from "@arcadeai/shared/models.js";
import { generateObject } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { isLlmAuthError } from "./client.js";

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
    const start = Date.now();
    const { object, usage } = await generateObject({
      model: openai(GPT_MINI),
      schema: Schema,
      system: SYSTEM,
      prompt,
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
    return { category: object.category };
  } catch (err) {
    if (isLlmAuthError(err)) {
      logger?.error({ err }, "category classify failed: LLM auth/config error");
    } else {
      logger?.warn({ err, raw: args.message }, "category classify failed; defaulting to runtime");
    }
    return { category: "runtime" };
  }
}
