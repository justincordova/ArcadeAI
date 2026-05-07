import { useQuery } from "@tanstack/react-query";

const API = "http://localhost:3000";

interface AppConfig {
  hasAnthropicKey: boolean;
  hasOpenAiKey: boolean;
}

async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch(`${API}/api/config`);
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json() as Promise<AppConfig>;
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
 * Returns a human-readable error message if required AI keys are absent,
 * or null if everything looks good.
 */
export function getMissingKeyError(config: AppConfig | undefined): string | null {
  if (!config) return "Checking AI provider configuration...";
  if (!config.hasAnthropicKey && !config.hasOpenAiKey) {
    return "No AI provider key is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in the server .env file.";
  }
  if (!config.hasAnthropicKey) {
    return "ANTHROPIC_API_KEY is not set. Add it to the server .env file to enable game generation.";
  }
  return null;
}
