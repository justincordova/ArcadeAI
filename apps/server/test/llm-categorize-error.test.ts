// Unit test for services/llm/categorize-error.ts. Verifies the contract
// that classification must never block the repair pipeline (SPEC §3) — any
// failure defaults to 'runtime'.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Spread the real module so sibling tests' streamText / embed exports stay
// intact under our partial override.
const realAi = await import("ai");

beforeEach(() => {
  mock.module("ai", () => ({
    ...realAi,
    generateObject: async () => ({
      object: { category: "syntax" },
      usage: { inputTokens: 5, outputTokens: 1 },
    }),
  }));
});

afterEach(() => {
  mock.module("ai", () => realAi);
});

describe("categorizeError", () => {
  test("returns the model's category on success", async () => {
    const { categorizeError } = await import("../src/services/llm/categorize-error.js");

    const result = await categorizeError({ message: "Unexpected token" });
    expect(result.category).toBe("syntax");
  });

  test("defaults to 'runtime' when the LLM throws", async () => {
    mock.module("ai", () => ({
      ...realAi,
      generateObject: async () => {
        throw new Error("openai 503");
      },
    }));
    const { categorizeError } = await import("../src/services/llm/categorize-error.js");

    const result = await categorizeError({ message: "anything" });
    expect(result.category).toBe("runtime");
  });

  test("defaults to 'runtime' when the model returns garbage that fails Zod parsing", async () => {
    // generateObject internally validates against the schema; if validation
    // throws, our outer try/catch swallows and returns the default. Simulate
    // that by having the mock throw — same effective contract.
    mock.module("ai", () => ({
      ...realAi,
      generateObject: async () => {
        throw new Error("schema validation failed");
      },
    }));
    const { categorizeError } = await import("../src/services/llm/categorize-error.js");

    const result = await categorizeError({ message: "anything" });
    expect(result.category).toBe("runtime");
  });
});
