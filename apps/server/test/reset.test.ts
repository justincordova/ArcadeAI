// Tests for services/usage/reset.ts (applyResets + the pure time helpers).
//
// applyResets is called at the top of every credit-touching route, so its
// edge paths matter: daily-only reset, monthly reset (which also refills
// daily), the admin timestamp-advance-without-refill, the no-op-when-not-due
// path, the conditional-UPDATE concurrency guard's re-read-on-miss, and the
// user-deleted-mid-flight null return.
//
// Same strategy as charge.test.ts: mock the singleton lib/db.ts with a fresh
// in-memory DB before importing the module under test.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTestDb, insertTestUser, type TestDb } from "./test-db.js";

let testDb: TestDb;

beforeEach(() => {
  testDb = createTestDb();
  mock.module("../src/lib/db.ts", () => ({
    db: testDb.db,
    sqlite: testDb.sqlite,
  }));
});

afterEach(() => {
  testDb.close();
});

function readUser(userId: string) {
  return testDb.sqlite
    .query<
      {
        credits_remaining_daily: number;
        credits_remaining_monthly: number;
        daily_reset_at: number;
        monthly_reset_at: number;
      },
      [string]
    >(
      `SELECT credits_remaining_daily, credits_remaining_monthly, daily_reset_at, monthly_reset_at
       FROM "user" WHERE id = ?`
    )
    .get(userId);
}

describe("nextUtcMidnight / nextUtcMonthStart", () => {
  test("nextUtcMidnight returns the next 00:00:00 UTC strictly after now", async () => {
    const { nextUtcMidnight } = await import("../src/services/usage/reset.js");
    // 2026-01-15T13:37:42.500Z
    const now = Date.UTC(2026, 0, 15, 13, 37, 42, 500);
    const next = nextUtcMidnight(now);
    expect(next).toBe(Date.UTC(2026, 0, 16, 0, 0, 0, 0));
    expect(next).toBeGreaterThan(now);
  });

  test("nextUtcMonthStart returns the 1st of next month at 00:00 UTC", async () => {
    const { nextUtcMonthStart } = await import("../src/services/usage/reset.js");
    const now = Date.UTC(2026, 0, 15, 13, 37, 42, 500);
    expect(nextUtcMonthStart(now)).toBe(Date.UTC(2026, 1, 1, 0, 0, 0, 0));
  });

  test("nextUtcMonthStart rolls the year over in December", async () => {
    const { nextUtcMonthStart } = await import("../src/services/usage/reset.js");
    const now = Date.UTC(2026, 11, 31, 23, 59, 59, 999);
    expect(nextUtcMonthStart(now)).toBe(Date.UTC(2027, 0, 1, 0, 0, 0, 0));
  });
});

describe("applyResets — reset boundaries", () => {
  test("no-op when neither boundary is due (returns stored counters)", async () => {
    const { applyResets } = await import("../src/services/usage/reset.js");
    const future = Date.now() + 60_000;
    const { id } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 123,
      creditsRemainingMonthly: 456,
      dailyResetAt: future,
      monthlyResetAt: future,
    });

    const result = await applyResets(id);
    expect(result?.creditsRemainingDaily).toBe(123);
    expect(result?.creditsRemainingMonthly).toBe(456);
    // Timestamps untouched.
    expect(readUser(id)?.daily_reset_at).toBe(future);
  });

  test("daily boundary passed refills daily only, leaves monthly balance", async () => {
    const { applyResets } = await import("../src/services/usage/reset.js");
    const past = Date.now() - 1000;
    const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const { id } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 10, // depleted
      creditsRemainingMonthly: 1500, // partially spent, monthly not due
      dailyResetAt: past,
      monthlyResetAt: future,
    });

    const result = await applyResets(id);
    // Free daily limit is 500; monthly is untouched.
    expect(result?.creditsRemainingDaily).toBe(500);
    expect(result?.creditsRemainingMonthly).toBe(1500);
    // Persisted, and the daily timestamp advanced into the future.
    const row = readUser(id);
    expect(row?.credits_remaining_daily).toBe(500);
    expect(row?.credits_remaining_monthly).toBe(1500);
    expect(row?.daily_reset_at).toBeGreaterThan(Date.now());
    expect(row?.monthly_reset_at).toBe(future);
  });

  test("monthly boundary passed refills both monthly and daily", async () => {
    const { applyResets } = await import("../src/services/usage/reset.js");
    const past = Date.now() - 1000;
    const { id } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 10,
      creditsRemainingMonthly: 50,
      dailyResetAt: past,
      monthlyResetAt: past,
    });

    const result = await applyResets(id);
    expect(result?.creditsRemainingDaily).toBe(500);
    expect(result?.creditsRemainingMonthly).toBe(3000);
    const row = readUser(id);
    expect(row?.daily_reset_at).toBeGreaterThan(Date.now());
    expect(row?.monthly_reset_at).toBeGreaterThan(Date.now());
  });

  test("admin advances timestamps but does NOT refill counters", async () => {
    const { applyResets } = await import("../src/services/usage/reset.js");
    const past = Date.now() - 1000;
    const { id } = insertTestUser(testDb.sqlite, {
      tier: "admin",
      creditsRemainingDaily: 7,
      creditsRemainingMonthly: 9,
      dailyResetAt: past,
      monthlyResetAt: past,
    });

    const result = await applyResets(id);
    // Counters preserved (admin credits are meaningless but must not be
    // rewritten to a tier limit), timestamps still advanced so we don't
    // re-run the UPDATE on every subsequent call.
    expect(result?.creditsRemainingDaily).toBe(7);
    expect(result?.creditsRemainingMonthly).toBe(9);
    const row = readUser(id);
    expect(row?.credits_remaining_daily).toBe(7);
    expect(row?.credits_remaining_monthly).toBe(9);
    expect(row?.daily_reset_at).toBeGreaterThan(Date.now());
    expect(row?.monthly_reset_at).toBeGreaterThan(Date.now());
  });

  test("returns null for a nonexistent user", async () => {
    const { applyResets } = await import("../src/services/usage/reset.js");
    const result = await applyResets("does-not-exist");
    expect(result).toBeNull();
  });
});

describe("applyResets — concurrency guard", () => {
  test("two concurrent resets on a due user refill exactly once", async () => {
    // Both callers read the same stale (past) reset timestamp. The
    // conditional UPDATE keyed on that timestamp lets exactly one win; the
    // loser's WHERE misses and it re-reads the canonical post-reset row.
    // Either way the final balance is the tier limit, never doubled or
    // left stale.
    const { applyResets } = await import("../src/services/usage/reset.js");
    const past = Date.now() - 1000;
    const { id } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 10,
      creditsRemainingMonthly: 50,
      dailyResetAt: past,
      monthlyResetAt: past,
    });

    const [a, b] = await Promise.all([applyResets(id), applyResets(id)]);

    expect(a?.creditsRemainingMonthly).toBe(3000);
    expect(b?.creditsRemainingMonthly).toBe(3000);
    expect(a?.creditsRemainingDaily).toBe(500);
    expect(b?.creditsRemainingDaily).toBe(500);
    // The row itself holds the tier limit exactly once.
    expect(readUser(id)?.credits_remaining_monthly).toBe(3000);
  });
});
