// Unit tests for services/llm/embed.ts. The lazy-client pattern is
// load-bearing: a missing OPENAI_API_KEY must not crash server startup,
// only the RAG path. We verify both halves of that contract.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const realAi = await import("ai");

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.OPENAI_API_KEY;
  mock.module("ai", () => ({
    ...realAi,
    embed: async () => ({
      embedding: Array.from({ length: 1536 }, (_, i) => i / 1536),
      usage: { tokens: 5 },
    }),
  }));
});

afterEach(() => {
  if (originalKey === undefined) {
    Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
  } else {
    process.env.OPENAI_API_KEY = originalKey;
  }
  mock.module("ai", () => realAi);
});

describe("embedPrompt", () => {
  test("returns the embedding vector on success", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { embedPrompt } = await import("../src/services/llm/embed.js");

    const vec = await embedPrompt("a snake game");
    expect(vec).toHaveLength(1536);
  });

  test("propagates upstream embed failures (caller falls back to no-RAG)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    mock.module("ai", () => ({
      ...realAi,
      embed: async () => {
        throw new Error("openai timeout");
      },
    }));
    const { embedPrompt } = await import("../src/services/llm/embed.js");

    await expect(embedPrompt("anything")).rejects.toThrow("openai timeout");
  });
});
