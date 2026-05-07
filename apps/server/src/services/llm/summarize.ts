import { createOpenAI } from "@ai-sdk/openai";
import { GPT_MINI } from "@arcadeai/shared";
import { generateText } from "ai";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SUMMARIZE_SYSTEM_PROMPT =
  "Summarize this single-file HTML game into a structural digest for another model that will rewrite parts of it. Include: function signatures (name + params), top-level constants and their roles, brief outline of the main game loop and state machine. Do NOT reproduce the full code. Be terse.";

export async function summarizeCode(html: string): Promise<string> {
  const { text } = await generateText({
    model: openai(GPT_MINI),
    system: SUMMARIZE_SYSTEM_PROMPT,
    prompt: html,
  });
  return text;
}
