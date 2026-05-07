import { openai } from "@ai-sdk/openai";
import { GPT_MINI } from "@arcadeai/shared/models.js";
import { generateText } from "ai";

const SYSTEM =
  "Generate a concise, descriptive game title for the user's prompt. Return only the title — no quotes, no punctuation, no preamble. Maximum 80 characters.";

/**
 * Generate a short title for a game prompt. No internal try/catch — the
 * caller wraps in Promise.allSettled so a rejection keeps the placeholder
 * title (SPEC §7 / §19 step 10).
 */
export async function generateTitle(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: openai(GPT_MINI),
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  return text.trim().slice(0, 80);
}
