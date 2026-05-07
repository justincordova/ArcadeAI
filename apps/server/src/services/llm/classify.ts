import { openai } from "@ai-sdk/openai";
import { GENRE_BUCKETS, type GenreBucket } from "@arcadeai/shared/genres.js";
import { GPT_MINI } from "@arcadeai/shared/models.js";
import { generateObject } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";

const Schema = z.object({
  genre: z.enum(GENRE_BUCKETS),
  style_tags: z.array(z.string()).max(5),
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
    const { object } = await generateObject({
      model: openai(GPT_MINI),
      schema: Schema,
      system: SYSTEM,
      prompt,
    });
    const genre = (GENRE_BUCKETS as readonly string[]).includes(object.genre)
      ? (object.genre as GenreBucket)
      : "other";
    return { genre, styleTags: object.style_tags };
  } catch (err) {
    logger?.warn({ err }, "genre classification failed; defaulting to other");
    return { genre: "other", styleTags: [] };
  }
}
