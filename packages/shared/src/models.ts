export const SONNET = "claude-sonnet-4-6";
export const OPUS = "claude-opus-4-7";
export const GPT_MINI = "gpt-4.1-mini";
export const EMBEDDING = "text-embedding-3-small";

// Per-million-token list prices (USD). See SPEC §14 / §18.
// Update these if provider pricing changes; no other code references list prices directly.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  [SONNET]: { input: 3.0, output: 15.0 },
  [OPUS]: { input: 15.0, output: 75.0 },
  [GPT_MINI]: { input: 0.4, output: 1.6 },
  [EMBEDDING]: { input: 0.02, output: 0.0 },
};

/**
 * Compute the estimated USD cost for an LLM call (SPEC §14).
 * Accepts AI SDK v6 usage shape: inputTokens / outputTokens.
 * Returns 0 for unknown models — logging must never crash a request.
 */
export function computeCost(args: {
  model: string;
  usage: { inputTokens?: number | null; outputTokens?: number | null };
}): number {
  const p = MODEL_PRICES[args.model];
  if (!p) return 0;
  return (
    ((args.usage.inputTokens ?? 0) / 1_000_000) * p.input +
    ((args.usage.outputTokens ?? 0) / 1_000_000) * p.output
  );
}
