import { createAnthropic } from "@ai-sdk/anthropic";
import { SONNET } from "@arcadeai/shared";
import { streamText } from "ai";
import { GENERATION_SYSTEM_PROMPT } from "./prompts/generation.js";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

export async function streamGame({
  prompt,
  signal,
}: {
  prompt: string;
  signal: AbortSignal;
}) {
  return streamText({
    model: anthropic(SONNET),
    system: GENERATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    abortSignal: signal,
    maxOutputTokens: 8192,
  });
}

export async function streamRefinement({
  system,
  prompt,
  signal,
}: {
  system: string;
  prompt: string;
  signal: AbortSignal;
}) {
  return streamText({
    model: anthropic(SONNET),
    system,
    messages: [{ role: "user", content: prompt }],
    abortSignal: signal,
    maxOutputTokens: 8192,
  });
}
