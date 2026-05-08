// Tests for lib/env.ts. We use a `_resetEnvForTests` helper exposed by the
// module to bust the loadEnv() memoization between cases without fighting
// Bun's module cache.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _resetEnvForTests, loadEnv } from "../src/lib/env.js";

const ORIGINAL_ENV = { ...process.env };

const MANAGED_KEYS = [
  "NODE_ENV",
  "LOG_LEVEL",
  "PORT",
  "WEB_ORIGIN",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "ADMIN_EMAILS",
  "DATABASE_PATH",
];

beforeEach(() => {
  _resetEnvForTests();
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  _resetEnvForTests();
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

describe("loadEnv — development mode", () => {
  test("accepts missing OAuth/AI keys in development with sensible defaults", () => {
    process.env.NODE_ENV = "development";
    const env = loadEnv();
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.WEB_ORIGIN).toBe("http://localhost:5173");
  });

  test("PORT defaults to 3000 when unset", () => {
    process.env.NODE_ENV = "development";
    expect(loadEnv().PORT).toBe(3000);
  });

  test("PORT parses a numeric string", () => {
    process.env.NODE_ENV = "development";
    process.env.PORT = "4000";
    expect(loadEnv().PORT).toBe(4000);
  });

  test("rejects non-numeric PORT with a clear message", () => {
    process.env.NODE_ENV = "development";
    process.env.PORT = "not-a-number";
    expect(() => loadEnv()).toThrow(/PORT must be a positive integer/);
  });

  test("rejects malformed WEB_ORIGIN", () => {
    process.env.NODE_ENV = "development";
    process.env.WEB_ORIGIN = "not a url";
    expect(() => loadEnv()).toThrow();
  });
});

describe("loadEnv — production mode", () => {
  test("rejects missing BETTER_AUTH_SECRET in production", () => {
    process.env.NODE_ENV = "production";
    process.env.GOOGLE_CLIENT_ID = "x";
    process.env.GOOGLE_CLIENT_SECRET = "x";
    process.env.GITHUB_CLIENT_ID = "x";
    process.env.GITHUB_CLIENT_SECRET = "x";
    process.env.ANTHROPIC_API_KEY = "x";
    process.env.OPENAI_API_KEY = "x";
    expect(() => loadEnv()).toThrow(/BETTER_AUTH_SECRET/);
  });

  test("rejects missing OAuth credentials in production", () => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_SECRET = "secret";
    process.env.ANTHROPIC_API_KEY = "x";
    process.env.OPENAI_API_KEY = "x";
    expect(() => loadEnv()).toThrow();
  });

  test("succeeds in production with all required keys present", () => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_SECRET = "secret";
    process.env.GOOGLE_CLIENT_ID = "g";
    process.env.GOOGLE_CLIENT_SECRET = "g";
    process.env.GITHUB_CLIENT_ID = "h";
    process.env.GITHUB_CLIENT_SECRET = "h";
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.OPENAI_API_KEY = "o";
    expect(loadEnv().NODE_ENV).toBe("production");
  });

  test("error message lists multiple missing keys in one shot", () => {
    process.env.NODE_ENV = "production";
    let caught: unknown;
    try {
      loadEnv();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/BETTER_AUTH_SECRET/);
    expect(msg).toMatch(/GOOGLE_CLIENT_ID/);
    expect(msg).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe("loadEnv — defaults", () => {
  test("LOG_LEVEL defaults to info", () => {
    process.env.NODE_ENV = "development";
    expect(loadEnv().LOG_LEVEL).toBe("info");
  });

  test("ADMIN_EMAILS defaults to empty string", () => {
    process.env.NODE_ENV = "development";
    expect(loadEnv().ADMIN_EMAILS).toBe("");
  });

  test("rejects an unknown LOG_LEVEL value", () => {
    process.env.NODE_ENV = "development";
    process.env.LOG_LEVEL = "verbose"; // not a valid pino level
    expect(() => loadEnv()).toThrow();
  });
});

describe("loadEnv — memoization", () => {
  test("returns the same cached object on repeated calls", () => {
    process.env.NODE_ENV = "development";
    const a = loadEnv();
    const b = loadEnv();
    expect(a).toBe(b);
  });

  test("_resetEnvForTests forces re-evaluation", () => {
    process.env.NODE_ENV = "development";
    process.env.PORT = "3000";
    expect(loadEnv().PORT).toBe(3000);

    _resetEnvForTests();
    process.env.PORT = "4000";
    expect(loadEnv().PORT).toBe(4000);
  });
});
