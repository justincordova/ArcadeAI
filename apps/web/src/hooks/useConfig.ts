import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api/client.js";

interface AppConfig {
  hasAnthropicKey: boolean;
  hasOpenAiKey: boolean;
}

async function fetchConfig(): Promise<AppConfig> {
  return apiFetch<AppConfig>("/api/config");
}

export function useConfig() {
  return useQuery<AppConfig>({
    queryKey: ["config"],
    queryFn: fetchConfig,
    staleTime: 60_000 * 5, // 5 min — keys don't change at runtime
    retry: false,
  });
}

/**
 * Returns a human-readable error message if required AI keys are absent, or
 * null if everything looks good OR the configuration is not yet known.
 *
 * `undefined` config means "still loading, or the request failed" — not "keys
 * are missing". The sole caller renders this under a "Setup required" heading
 * and disables the prompt input, so returning a message here asserted a
 * failure that had not been determined: the builder showed "Setup required"
 * with a dead textarea on every first visit while /api/config was in flight.
 * Worse, useConfig sets retry:false, so one failed request left the builder
 * permanently locked with no retry affordance.
 *
 * Returning null on an unknown state is safe: if a key really is missing the
 * server rejects the generation and that error surfaces in the stream banner.
 */
export function getMissingKeyError(config: AppConfig | undefined): string | null {
  if (!config) return null;
  if (!config.hasAnthropicKey && !config.hasOpenAiKey) {
    return "No AI provider key is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in the server .env file.";
  }
  if (!config.hasAnthropicKey) {
    return "ANTHROPIC_API_KEY is not set. Add it to the server .env file to enable game generation.";
  }
  return null;
}
