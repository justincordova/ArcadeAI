// Unit tests for lib/auth-helpers — pure functions, no DB.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isAdminEmail, randomHex } from "../src/lib/auth-helpers.js";

describe("isAdminEmail", () => {
  let originalAdminEmails: string | undefined;

  beforeEach(() => {
    originalAdminEmails = process.env.ADMIN_EMAILS;
  });

  afterEach(() => {
    if (originalAdminEmails === undefined) {
      Reflect.deleteProperty(process.env, "ADMIN_EMAILS");
    } else {
      process.env.ADMIN_EMAILS = originalAdminEmails;
    }
  });

  test("matches an exact email in the comma-separated list", () => {
    process.env.ADMIN_EMAILS = "alice@example.com,bob@example.com";
    expect(isAdminEmail("alice@example.com")).toBe(true);
    expect(isAdminEmail("bob@example.com")).toBe(true);
  });

  test("is case-insensitive", () => {
    process.env.ADMIN_EMAILS = "Alice@Example.COM";
    expect(isAdminEmail("alice@example.com")).toBe(true);
    expect(isAdminEmail("ALICE@EXAMPLE.COM")).toBe(true);
  });

  test("trims whitespace around list entries", () => {
    process.env.ADMIN_EMAILS = " alice@example.com , bob@example.com ";
    expect(isAdminEmail("alice@example.com")).toBe(true);
    expect(isAdminEmail("bob@example.com")).toBe(true);
  });

  test("returns false for non-matching emails", () => {
    process.env.ADMIN_EMAILS = "alice@example.com";
    expect(isAdminEmail("eve@example.com")).toBe(false);
    expect(isAdminEmail("alice@evil.com")).toBe(false);
  });

  test("returns false when ADMIN_EMAILS is unset", () => {
    Reflect.deleteProperty(process.env, "ADMIN_EMAILS");
    expect(isAdminEmail("alice@example.com")).toBe(false);
  });

  test("returns false when ADMIN_EMAILS is empty", () => {
    process.env.ADMIN_EMAILS = "";
    expect(isAdminEmail("alice@example.com")).toBe(false);
  });

  test("does not match the empty string against an empty list", () => {
    process.env.ADMIN_EMAILS = "";
    expect(isAdminEmail("")).toBe(false);
  });
});

describe("randomHex", () => {
  test("returns a hex string of length 2 * bytes", () => {
    expect(randomHex(4)).toMatch(/^[0-9a-f]{8}$/);
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });

  test("produces distinct values on repeated calls", () => {
    const a = randomHex(8);
    const b = randomHex(8);
    expect(a).not.toBe(b);
  });
});
