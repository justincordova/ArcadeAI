import { openai } from "@ai-sdk/openai";
import { GENRE_BUCKETS, type GenreBucket } from "@arcadeai/shared/genres.js";
import { computeCost, GPT_MINI } from "@arcadeai/shared/models.js";
import { generateObject } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { AUX_LLM_TIMEOUT_MS, isLlmAuthError } from "./client.js";

const Schema = z.object({
  genre: z.enum(GENRE_BUCKETS),
  // Collapse whitespace and clamp each tag. style_tags is model-derived from
  // the user's prompt and gets joined verbatim into the *generation system
  // prompt* ("Style guidance: ..."). Without a per-string bound a crafted
  // prompt could make the classifier emit long, multi-line, instruction-shaped
  // tags that inflate tokens and inject pseudo-instructions into the system
  // block. Short aesthetic descriptors never need more than a few words, so we
  // truncate (rather than reject, which would discard the whole classification).
  // Clamp the list length with a transform rather than `.max(5)`: a schema
  // rejection on a 6th tag would throw out the ENTIRE classification —
  // including a perfectly good genre — which is exactly the reject-vs-
  // truncate tradeoff the comment above argues against.
  style_tags: z
    .array(z.string().transform((s) => s.replace(/\s+/g, " ").trim().slice(0, 40)))
    .transform((tags) => tags.slice(0, 5)),
});

const SYSTEM =
  "Classify the user's game prompt into one of these genres: paddle, snake, flappy, shooter, platformer, puzzle, runner, other. Use 'other' if uncertain. Also extract up to 5 short aesthetic descriptors (e.g. retro, neon, minimal, cute, dark).";

/**
 * Classify a game prompt into a genre bucket and extract style tags.
 * Never throws — returns { genre: 'other', styleTags: [] } on any failure (SPEC §6).
 */
export async function classifyPrompt(
  prompt: string,
  logger?: FastifyBaseLogger
): Promise<{ genre: GenreBucket; styleTags: string[] }> {
  try {
    const start = Date.now();
    const { object, usage } = await generateObject({
      model: openai(GPT_MINI),
      schema: Schema,
      system: SYSTEM,
      prompt,
      // This call is awaited before generation starts; a hung socket would
      // otherwise stall the stream forever (the catch only fires on
      // rejection, and a hang never settles).
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
    const genre = (GENRE_BUCKETS as readonly string[]).includes(object.genre)
      ? (object.genre as GenreBucket)
      : "other";
    return { genre, styleTags: object.style_tags };
  } catch (err) {
    // Auth/config failures (dead/invalid key) hit 100% of requests and must be
    // visible to ops; transient failures stay at warn. Either way we soft-fail.
    if (isLlmAuthError(err)) {
      logger?.error({ err }, "genre classification failed: LLM auth/config error");
    } else {
      logger?.warn({ err }, "genre classification failed; defaulting to other");
    }
    return { genre: "other", styleTags: [] };
  }
}
