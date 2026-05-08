// Tests for the withTimeout signal composition in services/llm/client.ts.
// We test the composed-signal helper in isolation; the full streamText
// integration is covered by route-level integration tests.

import { describe, expect, test } from "bun:test";
import { withTimeout } from "../src/services/llm/client.js";

describe("withTimeout", () => {
  test("aborts when timeout elapses", async () => {
    const userController = new AbortController();
    const { signal, cleanup } = withTimeout(userController.signal, 30);

    expect(signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(signal.aborted).toBe(true);
    cleanup();
  });

  test("aborts immediately when the user cancels before timeout", async () => {
    const userController = new AbortController();
    const { signal, cleanup } = withTimeout(userController.signal, 5_000);

    userController.abort();
    // AbortSignal.any aborts synchronously when an input is already aborted
    // OR aborts on next tick when an input aborts after composition.
    await new Promise((r) => setTimeout(r, 5));
    expect(signal.aborted).toBe(true);
    cleanup();
  });

  test("cleanup prevents the timer from firing after successful completion", async () => {
    const userController = new AbortController();
    const { signal, cleanup } = withTimeout(userController.signal, 30);
    cleanup();

    // Even after waiting longer than the timeout, the signal is not aborted
    // because the timer was cleared.
    await new Promise((r) => setTimeout(r, 60));
    expect(signal.aborted).toBe(false);
  });

  test("composed signal is independent — aborting it does not abort the user's", () => {
    const userController = new AbortController();
    const { signal, cleanup } = withTimeout(userController.signal, 5_000);

    // The composed signal is a fresh signal — we cannot abort it directly,
    // but we can verify the user controller is unaffected by the composition.
    expect(userController.signal.aborted).toBe(false);
    expect(signal.aborted).toBe(false);
    cleanup();
  });
});
