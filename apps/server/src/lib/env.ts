// Centralized environment-variable validation. Run once at startup so
// missing/malformed config fails fast with a friendly error instead of
// surfacing as a confusing runtime crash later (e.g. an AI call failing
// with "401 unauthorized" 30s after a request arrives).
//
// In development we accept missing OAuth and AI keys — the dev experience
// includes "what does it look like with no Anthropic key?" testing — but
// we still validate WEB_ORIGIN, PORT, etc. In production every
// production-critical key is required.

import { z } from "zod";

// Base schema — all keys optional or with defaults. A second pass enforces
// the production-required ones based on the parsed NODE_ENV. This avoids
// closure-captured `isProd` evaluation order issues during testing.
const BaseSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PORT: z
    .string()
    .regex(/^\d+$/, "PORT must be a positive integer")
    .default("3000")
    .transform((s) => Number.parseInt(s, 10)),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),

  // LLM
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

  // Optional everywhere
  ADMIN_EMAILS: z.string().default(""),
  DATABASE_PATH: z.string().optional(),
});

const PROD_REQUIRED_KEYS = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "WEB_ORIGIN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
] as const;

// Sentinel values that must never appear in a production environment.
// BETTER_AUTH_SECRET has a development fallback baked into lib/auth.ts —
// if that fallback ever leaked into production via misconfiguration, every
// session signed by it would be forgeable. Reject it explicitly here so
// startup fails loudly rather than booting with a publicly-known key.
const FORBIDDEN_PROD_VALUES: Partial<Record<(typeof PROD_REQUIRED_KEYS)[number], string[]>> = {
  BETTER_AUTH_SECRET: ["dev-secret-change-me"],
  WEB_ORIGIN: ["http://localhost:5173"],
  BETTER_AUTH_URL: ["http://localhost:3000"],
};

export type Env = z.infer<typeof BaseSchema>;

let cached: Env | null = null;

/**
 * Parse process.env into a validated Env object. Throws an aggregated error
 * listing every problem if validation fails. Memoized so subsequent calls
 * are free.
 */
export function loadEnv(): Env {
  if (cached) return cached;

  const result = BaseSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  // Production strictness: collect every missing required key and surface
  // them all at once. Also reject dev-fallback values (e.g. the literal
  // BETTER_AUTH_SECRET we use locally) that would silently downgrade
  // security if they leaked into a production deploy.
  if (result.data.NODE_ENV === "production") {
    const problems: string[] = [];
    for (const k of PROD_REQUIRED_KEYS) {
      if (!result.data[k]) {
        problems.push(`  - ${k}: required in production`);
        continue;
      }
      const forbidden = FORBIDDEN_PROD_VALUES[k];
      if (forbidden?.includes(String(result.data[k]))) {
        problems.push(`  - ${k}: development-only value not permitted in production`);
      }
    }
    if (problems.length > 0) {
      throw new Error(`Environment validation failed:\n${problems.join("\n")}`);
    }
  }

  cached = result.data;
  return cached;
}

/**
 * Reset the memoized env. Used by tests to re-evaluate from a mutated
 * process.env. Not exported from the public surface in production.
 */
export function _resetEnvForTests(): void {
  cached = null;
}
