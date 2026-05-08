// Unit test for services/llm/title.ts. The Vercel AI SDK is mocked so we
// don't make real API calls — we just verify the post-processing behavior
// (trim + 80-char clamp) that the spec calls for.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Capture the original module so we can spread its exports into our partial
// override. `mock.module` is process-global, and replacing the whole module
// would break sibling tests that exercise streamText / embed via real (or
// previously-mocked) paths.
const realAi = await import("ai");

let nextResult: { text: string; usage: { inputTokens: number; outputTokens: number } } = {
  text: "",
  usage: { inputTokens: 0, outputTokens: 0 },
};

beforeEach(() => {
  mock.module("ai", () => ({
    ...realAi,
    generateText: async () => nextResult,
  }));
});

afterEach(() => {
  nextResult = { text: "", usage: { inputTokens: 0, outputTokens: 0 } };
  // Restore the real module for downstream tests that may run after us.
  mock.module("ai", () => realAi);
});

describe("generateTitle", () => {
  test("returns the model's text trimmed", async () => {
    nextResult = { text: "  Snake Game  ", usage: { inputTokens: 5, outputTokens: 3 } };
    const { generateTitle } = await import("../src/services/llm/title.js");

    const title = await generateTitle("a simple snake game");
    expect(title).toBe("Snake Game");
  });

  test("clamps output to 80 characters", async () => {
    const tooLong = "x".repeat(120);
    nextResult = { text: tooLong, usage: { inputTokens: 5, outputTokens: 3 } };
    const { generateTitle } = await import("../src/services/llm/title.js");

    const title = await generateTitle("anything");
    expect(title.length).toBe(80);
    expect(title).toBe("x".repeat(80));
  });

  test("propagates errors (caller uses Promise.allSettled to keep placeholder)", async () => {
    mock.module("ai", () => ({
      ...realAi,
      generateText: async () => {
        throw new Error("network down");
      },
    }));
    const { generateTitle } = await import("../src/services/llm/title.js");

    await expect(generateTitle("anything")).rejects.toThrow("network down");
  });
});
