// Tests for lib/active-streams.ts — the in-memory concurrency lock that
// enforces "at most one active streaming operation per user" (SPEC §14).

import { afterEach, describe, expect, test } from "bun:test";
import {
  acquire,
  activeCount,
  ConcurrencyError,
  clear,
  release,
} from "../src/lib/active-streams.js";

afterEach(() => {
  // Ensure isolation — the lock set is module-scoped.
  clear();
});

describe("active-streams", () => {
  test("acquire then release leaves the set empty", () => {
    expect(activeCount()).toBe(0);
    acquire("user-1");
    expect(activeCount()).toBe(1);
    release("user-1");
    expect(activeCount()).toBe(0);
  });

  test("two different users can both hold locks simultaneously", () => {
    acquire("user-1");
    acquire("user-2");
    expect(activeCount()).toBe(2);
  });

  test("re-acquire by the same user throws ConcurrencyError", () => {
    acquire("user-1");
    expect(() => acquire("user-1")).toThrow(ConcurrencyError);
  });

  test("release of a non-held key is a no-op", () => {
    expect(() => release("never-acquired")).not.toThrow();
    expect(activeCount()).toBe(0);
  });

  test("clear empties the set", () => {
    acquire("user-1");
    acquire("user-2");
    clear();
    expect(activeCount()).toBe(0);
    // After clear, the same userId can re-acquire.
    expect(() => acquire("user-1")).not.toThrow();
  });

  test("ConcurrencyError carries the expected name and message", () => {
    let caught: unknown;
    try {
      acquire("user-1");
      acquire("user-1");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConcurrencyError);
    expect((caught as Error).name).toBe("ConcurrencyError");
    expect((caught as Error).message).toBe("A generation is already in progress");
  });
});
