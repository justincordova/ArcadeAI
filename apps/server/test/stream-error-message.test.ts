// Tests for the SSE error-message scrubbing helpers in routes/games/shared.ts.
//
// SSE responses call reply.hijack(), which bypasses Fastify's setErrorHandler
// and therefore the 5xx message scrubbing in index.ts. toClientMessage()
// reproduces that scrubbing for the streaming paths.

import { describe, expect, test } from "bun:test";
import {
  classifyRefundReason,
  toClientMessage,
  UserFacingError,
} from "../src/routes/games/shared.js";

describe("toClientMessage", () => {
  test("passes through a message this codebase authored", () => {
    const err = new UserFacingError("Generation hit the output token limit.");
    expect(toClientMessage(err, "Generation failed")).toBe(
      "Generation hit the output token limit."
    );
  });

  test("substitutes the fallback for an SDK error", () => {
    // Anthropic SDK errors carry upstream response bodies and request IDs.
    const err = new Error(
      'AI_APICallError: {"type":"error","error":{"message":"x-api-key header is required"}}'
    );
    expect(toClientMessage(err, "Generation failed")).toBe("Generation failed");
  });

  test("substitutes the fallback for a database error", () => {
    // Drizzle / bun:sqlite messages disclose schema.
    const err = new Error("UNIQUE constraint failed: games.public_slug");
    expect(toClientMessage(err, "Refinement failed")).toBe("Refinement failed");
  });

  test("a subclass of Error that is not UserFacingError is still scrubbed", () => {
    class WeirdError extends Error {}
    expect(toClientMessage(new WeirdError("internal detail"), "Repair failed")).toBe(
      "Repair failed"
    );
  });
});

describe("classifyRefundReason still sees the unscrubbed message", () => {
  // Scrubbing is presentation-only: refund classification and the server logs
  // must keep operating on the real error.
  test("classifies a timeout from the raw message", () => {
    expect(classifyRefundReason(new Error("Request timed out after 180000ms"))).toBe("timeout");
  });

  test("classifies an abort", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(classifyRefundReason(err)).toBe("abort");
  });

  test("classifies everything else as llm_error", () => {
    expect(classifyRefundReason(new Error("UNIQUE constraint failed"))).toBe("llm_error");
  });

  test("a UserFacingError classifies on its own message like any other Error", () => {
    expect(
      classifyRefundReason(new UserFacingError("Generation hit the output token limit."))
    ).toBe("llm_error");
  });
});
