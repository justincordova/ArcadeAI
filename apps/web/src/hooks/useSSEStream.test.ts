import { describe, expect, test } from "vitest";
import { normalizeError, normalizeQuotaError } from "./useSSEStream.js";

describe("normalizeError", () => {
  test("reads the new envelope's `message`", () => {
    expect(normalizeError({ code: "CONFLICT", message: "busy" })).toEqual({ message: "busy" });
  });

  test("falls back to the legacy `error` field", () => {
    expect(normalizeError({ error: "old shape" })).toEqual({ message: "old shape" });
  });

  test("prefers `message` over `error` when both present", () => {
    expect(normalizeError({ message: "new", error: "old" })).toEqual({ message: "new" });
  });

  test("returns a generic message for non-objects", () => {
    expect(normalizeError(null)).toEqual({ message: "Request failed" });
    expect(normalizeError("a string")).toEqual({ message: "Request failed" });
    expect(normalizeError(undefined)).toEqual({ message: "Request failed" });
  });
});

describe("normalizeQuotaError", () => {
  test("reads the new nested-details shape", () => {
    const body = {
      code: "INSUFFICIENT_CREDITS",
      message: "Out of credits",
      details: { resetAt: 1234, kind: "daily" },
    };
    expect(normalizeQuotaError(body)).toEqual({
      message: "Out of credits",
      resetAt: 1234,
      kind: "daily",
    });
  });

  test("reads the legacy flat shape (resetAt/kind at top level)", () => {
    const body = { error: "Quota hit", resetAt: 999, kind: "monthly" };
    expect(normalizeQuotaError(body)).toEqual({
      message: "Quota hit",
      resetAt: 999,
      kind: "monthly",
    });
  });

  test("defaults resetAt to 0 when absent", () => {
    expect(normalizeQuotaError({ message: "x" })).toEqual({
      message: "x",
      resetAt: 0,
      kind: undefined,
    });
  });

  test("handles the lifetime kind (free-tier exhaustion)", () => {
    const body = { message: "Free trial used", details: { resetAt: 0, kind: "lifetime" } };
    expect(normalizeQuotaError(body)).toEqual({
      message: "Free trial used",
      resetAt: 0,
      kind: "lifetime",
    });
  });

  test("falls back to a generic message for non-objects", () => {
    expect(normalizeQuotaError(null)).toEqual({ message: "Quota exceeded", resetAt: 0 });
  });
});
