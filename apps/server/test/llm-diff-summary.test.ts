// Unit test for services/llm/diff-summary.ts. The Vercel AI SDK is mocked
// so we don't make real API calls — we verify the soft-fail contract (any
// failure returns null, never throws) and the "no visible changes"
// sentinel behavior.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const realAi = await import("ai");

let nextResult: { text: string; usage: { inputTokens: number; outputTokens: number } } = {
  text: "",
  usage: { inputTokens: 0, outputTokens: 0 },
};

const KEY = "OPENAI_API_KEY";
const ORIGINAL_OPENAI_KEY = process.env[KEY];

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  mock.module("ai", () => ({
    ...realAi,
    generateText: async () => nextResult,
  }));
});

afterEach(() => {
  nextResult = { text: "", usage: { inputTokens: 0, outputTokens: 0 } };
  if (ORIGINAL_OPENAI_KEY === undefined) {
    delete process.env[KEY];
  } else {
    process.env[KEY] = ORIGINAL_OPENAI_KEY;
  }
  mock.module("ai", () => realAi);
});

describe("generateDiffSummary", () => {
  test("returns trimmed model text on success", async () => {
    nextResult = {
      text: "  Increased ball speed and added wall-bounce sound.  ",
      usage: { inputTokens: 5, outputTokens: 3 },
    };
    const { generateDiffSummary } = await import("../src/services/llm/diff-summary.js");

    const result = await generateDiffSummary({
      feedback: "make the ball faster",
      previousCode: "<html>old</html>",
      newCode: "<html>new</html>",
    });
    expect(result).toBe("Increased ball speed and added wall-bounce sound.");
  });

  test("returns null when model says 'No visible changes.'", async () => {
    nextResult = {
      text: "No visible changes.",
      usage: { inputTokens: 5, outputTokens: 3 },
    };
    const { generateDiffSummary } = await import("../src/services/llm/diff-summary.js");

    const result = await generateDiffSummary({
      feedback: "make it better",
      previousCode: "<html>same</html>",
      newCode: "<html>same</html>",
    });
    expect(result).toBeNull();
  });

  test("returns null when model returns empty text", async () => {
    nextResult = { text: "   ", usage: { inputTokens: 5, outputTokens: 0 } };
    const { generateDiffSummary } = await import("../src/services/llm/diff-summary.js");

    const result = await generateDiffSummary({
      feedback: "anything",
      previousCode: "a",
      newCode: "b",
    });
    expect(result).toBeNull();
  });

  test("soft-fails to null on model errors (never throws)", async () => {
    mock.module("ai", () => ({
      ...realAi,
      generateText: async () => {
        throw new Error("openai down");
      },
    }));
    const { generateDiffSummary } = await import("../src/services/llm/diff-summary.js");

    const result = await generateDiffSummary({
      feedback: "x",
      previousCode: "a",
      newCode: "b",
    });
    expect(result).toBeNull();
  });

  test("returns null when OPENAI_API_KEY is missing", async () => {
    delete process.env[KEY];
    const { generateDiffSummary } = await import("../src/services/llm/diff-summary.js");

    const result = await generateDiffSummary({
      feedback: "x",
      previousCode: "a",
      newCode: "b",
    });
    expect(result).toBeNull();
  });
});
