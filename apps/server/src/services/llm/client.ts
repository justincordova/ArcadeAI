import { createAnthropic } from "@ai-sdk/anthropic";
import { SONNET } from "@arcadeai/shared";
import { streamText } from "ai";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

export async function streamGame({
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
