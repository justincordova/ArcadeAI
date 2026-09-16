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
  "SUPABASE_URL",
  "SUPABASE_JWKS_URL",
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "ADMIN_EMAILS",
  "TRUST_PROXY",
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
  function setProdRequiredKeys() {
    process.env.WEB_ORIGIN = "https://app.example.com";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.DATABASE_URL = "postgresql://postgres:password@db.example.com:5432/postgres";
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.OPENAI_API_KEY = "o";
  }

  test("rejects missing SUPABASE_URL in production", () => {
    process.env.NODE_ENV = "production";
    setProdRequiredKeys();
    const k = "SUPABASE_URL";
    delete process.env[k];
    expect(() => loadEnv()).toThrow(/SUPABASE_URL/);
  });

  test("rejects missing DATABASE_URL in production", () => {
    process.env.NODE_ENV = "production";
    setProdRequiredKeys();
    delete process.env.DATABASE_URL;
    expect(() => loadEnv()).toThrow(/DATABASE_URL/);
  });

  test("succeeds in production with all required keys present", () => {
    process.env.NODE_ENV = "production";
    setProdRequiredKeys();
    expect(loadEnv().NODE_ENV).toBe("production");
  });

  test("rejects the development SUPABASE_URL in production", () => {
    process.env.NODE_ENV = "production";
    setProdRequiredKeys();
    process.env.SUPABASE_URL = "http://127.0.0.1:55321";
    expect(() => loadEnv()).toThrow(/SUPABASE_URL/);
  });

  test("rejects the localhost WEB_ORIGIN default in production", () => {
    process.env.NODE_ENV = "production";
    setProdRequiredKeys();
    process.env.WEB_ORIGIN = "http://localhost:5173";
    expect(() => loadEnv()).toThrow(/WEB_ORIGIN/);
  });

  test("rejects the development DATABASE_URL in production", () => {
    process.env.NODE_ENV = "production";
    setProdRequiredKeys();
    process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
    expect(() => loadEnv()).toThrow(/DATABASE_URL/);
  });

  test("requires WEB_ORIGIN to be set in production", () => {
    process.env.NODE_ENV = "production";
    setProdRequiredKeys();
    // Default is http://localhost:5173, which is now rejected. Confirm
    // an explicit override is required.
    const k = "WEB_ORIGIN";
    delete process.env[k];
    expect(() => loadEnv()).toThrow(/WEB_ORIGIN/);
  });

  test("error message lists multiple missing keys in one shot", () => {
    process.env.NODE_ENV = "production";
    // Override the localhost defaults so we're testing "missing" not "forbidden"
    process.env.WEB_ORIGIN = "https://app.example.com";
    let caught: unknown;
    try {
      loadEnv();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/SUPABASE_URL/);
    expect(msg).toMatch(/DATABASE_URL/);
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

  test("TRUST_PROXY defaults to false (boolean)", () => {
    process.env.NODE_ENV = "development";
    expect(loadEnv().TRUST_PROXY).toBe(false);
  });

  test('TRUST_PROXY parses the string "true" into a boolean', () => {
    process.env.NODE_ENV = "development";
    process.env.TRUST_PROXY = "true";
    expect(loadEnv().TRUST_PROXY).toBe(true);
  });

  test("rejects a non-boolean TRUST_PROXY value", () => {
    process.env.NODE_ENV = "development";
    process.env.TRUST_PROXY = "yes";
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
