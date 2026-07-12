// Tests for services/usage/charge.ts.
//
// Strategy: replace the singleton `lib/db.ts` module export with a per-test
// in-memory SQLite via `mock.module`. The module mock must be installed
// BEFORE charge.ts is imported, so we use a lazy `import()` inside the
// test bodies.
//
// We test:
//   - Atomic credit deduction (TOCTOU race: two concurrent calls, only one
//     succeeds when balance == cost)
//   - Lifetime cap enforcement on free tier when ENFORCE flag is on
//   - Lifetime counter is incremented on success and decremented on refund
//   - Refund idempotency
//   - Refund decrements lifetime counter only when the original deduct
//     incremented it (recorded in usage_log.lifetime_counter_incremented)

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTestDb, insertTestUser, type TestDb } from "./test-db.js";

let testDb: TestDb;

// We re-create the DB before each test and re-mock the module so the freshly
// created Drizzle/sqlite handles are what charge.ts sees on import.
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

describe("deduct — basic credit accounting", () => {
  test("succeeds when balance >= cost (free tier)", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 500,
      creditsRemainingMonthly: 3000,
    });

    const { logId } = await deduct(userId, "generation", null);

    expect(logId).toBeTruthy();
    const user = testDb.sqlite
      .query<{ credits_remaining_daily: number; credits_remaining_monthly: number }, [string]>(
        `SELECT credits_remaining_daily, credits_remaining_monthly FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.credits_remaining_daily).toBe(300); // 500 - 200
    expect(user?.credits_remaining_monthly).toBe(2800); // 3000 - 200
  });

  test("throws InsufficientCreditsError(monthly) when monthly < cost", async () => {
    const { deduct, InsufficientCreditsError } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 500,
      creditsRemainingMonthly: 100, // less than 200 generation cost
    });

    let caught: unknown;
    try {
      await deduct(userId, "generation", null);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InsufficientCreditsError);
    expect((caught as InstanceType<typeof InsufficientCreditsError>).kind).toBe("monthly");
  });

  test("throws InsufficientCreditsError(daily) when daily < cost on free tier", async () => {
    const { deduct, InsufficientCreditsError } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 100,
      creditsRemainingMonthly: 3000,
    });

    let caught: unknown;
    try {
      await deduct(userId, "generation", null);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InsufficientCreditsError);
    expect((caught as InstanceType<typeof InsufficientCreditsError>).kind).toBe("daily");
  });

  test("admin tier bypasses all checks and inserts a 0-cost log row", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "admin",
      creditsRemainingDaily: 0,
      creditsRemainingMonthly: 0,
    });

    const { logId } = await deduct(userId, "generation", null);
    expect(logId).toBeTruthy();

    const log = testDb.sqlite
      .query<{ credits_charged: number; lifetime_counter_incremented: number }, [string]>(
        "SELECT credits_charged, lifetime_counter_incremented FROM usage_log WHERE id = ?"
      )
      .get(logId);
    expect(log?.credits_charged).toBe(0);
    expect(log?.lifetime_counter_incremented).toBe(0);
  });
});

describe("deduct — TOCTOU atomicity", () => {
  test("two concurrent deducts at exact balance: only one succeeds", async () => {
    const { deduct, InsufficientCreditsError } = await import("../src/services/usage/charge.js");
    // Set balance to exactly one generation worth of credits in both windows
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 200,
      creditsRemainingMonthly: 200,
      lifetimeGenerationsUsed: 1, // already at lifetime cap so the lifetime
      // guard is OFF; we want to test the credit guard in isolation.
      // Setting it to 1 (the cap is 1 by default) would block. Use 0 with
      // the flag off conceptually — but the flag is on. Instead, use paid tier.
    });
    // Actually: use creator tier so the lifetime cap doesn't apply at all.
    testDb.sqlite
      .prepare(
        `UPDATE "user" SET tier = 'creator', credits_remaining_daily = 200, credits_remaining_monthly = 200, lifetime_generations_used = 0 WHERE id = ?`
      )
      .run(userId);

    const results = await Promise.allSettled([
      deduct(userId, "generation", null),
      deduct(userId, "generation", null),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCreditsError);

    const user = testDb.sqlite
      .query<{ credits_remaining_monthly: number }, [string]>(
        `SELECT credits_remaining_monthly FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.credits_remaining_monthly).toBe(0); // 200 - 200, not -200
  });
});

describe("deduct — lifetime cap on free tier", () => {
  test("free user with lifetime_generations_used = 0 succeeds first generation", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 500,
      creditsRemainingMonthly: 3000,
      lifetimeGenerationsUsed: 0,
    });

    await deduct(userId, "generation", null);

    const user = testDb.sqlite
      .query<{ lifetime_generations_used: number }, [string]>(
        `SELECT lifetime_generations_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.lifetime_generations_used).toBe(1);
  });

  test("free user at the lifetime cap is rejected with kind=lifetime", async () => {
    const { deduct, InsufficientCreditsError } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 500,
      creditsRemainingMonthly: 3000,
      lifetimeGenerationsUsed: 1, // == FREE_TIER_LIFETIME_LIMITS.generations
    });

    let caught: unknown;
    try {
      await deduct(userId, "generation", null);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InsufficientCreditsError);
    expect((caught as InstanceType<typeof InsufficientCreditsError>).kind).toBe("lifetime");
    expect((caught as InstanceType<typeof InsufficientCreditsError>).resetAt).toBe(0);
  });

  test("free user can do exactly 3 refinements then is blocked", async () => {
    const { deduct, InsufficientCreditsError } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 500,
      creditsRemainingMonthly: 3000,
      lifetimeRefinementsUsed: 0,
    });

    // First, refinement requires the user to have already generated. We're
    // testing the charge layer in isolation so we just check the lifetime
    // counter math; the actual game-must-have-code check lives in routes.
    await deduct(userId, "refinement", null);
    await deduct(userId, "refinement", null);
    await deduct(userId, "refinement", null);

    let caught: unknown;
    try {
      await deduct(userId, "refinement", null);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InsufficientCreditsError);
    expect((caught as InstanceType<typeof InsufficientCreditsError>).kind).toBe("lifetime");

    const user = testDb.sqlite
      .query<{ lifetime_refinements_used: number }, [string]>(
        `SELECT lifetime_refinements_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.lifetime_refinements_used).toBe(3);
  });

  test("paid tier (creator) ignores lifetime cap entirely", async () => {
    const { deduct } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "creator",
      creditsRemainingDaily: 20000,
      creditsRemainingMonthly: 20000,
      lifetimeGenerationsUsed: 100, // way over the free cap; doesn't matter
    });

    const { logId } = await deduct(userId, "generation", null);
    expect(logId).toBeTruthy();

    const log = testDb.sqlite
      .query<{ lifetime_counter_incremented: number }, [string]>(
        "SELECT lifetime_counter_incremented FROM usage_log WHERE id = ?"
      )
      .get(logId);
    expect(log?.lifetime_counter_incremented).toBe(0);

    // Lifetime counter on user row is NOT incremented for creator tier
    const user = testDb.sqlite
      .query<{ lifetime_generations_used: number }, [string]>(
        `SELECT lifetime_generations_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.lifetime_generations_used).toBe(100);
  });
});

describe("refund — idempotency and lifetime decrement", () => {
  test("refund credits + decrement lifetime counter for free user", async () => {
    const { deduct, refund } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 500,
      creditsRemainingMonthly: 3000,
    });

    const { logId } = await deduct(userId, "generation", null);
    expect(
      testDb.sqlite
        .query<{ lifetime_generations_used: number }, [string]>(
          `SELECT lifetime_generations_used FROM "user" WHERE id = ?`
        )
        .get(userId)?.lifetime_generations_used
    ).toBe(1);

    await refund(logId);

    const user = testDb.sqlite
      .query<
        {
          credits_remaining_daily: number;
          credits_remaining_monthly: number;
          lifetime_generations_used: number;
        },
        [string]
      >(
        `SELECT credits_remaining_daily, credits_remaining_monthly, lifetime_generations_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.credits_remaining_daily).toBe(500);
    expect(user?.credits_remaining_monthly).toBe(3000);
    expect(user?.lifetime_generations_used).toBe(0);
  });

  test("refund is idempotent — second call is a no-op", async () => {
    const { deduct, refund } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 500,
      creditsRemainingMonthly: 3000,
    });

    const { logId } = await deduct(userId, "generation", null);
    await refund(logId);
    await refund(logId); // second call should NOT double-credit

    const user = testDb.sqlite
      .query<{ credits_remaining_monthly: number }, [string]>(
        `SELECT credits_remaining_monthly FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.credits_remaining_monthly).toBe(3000); // not 3200
  });

  test("concurrent refunds do not double-credit (atomic claim guard)", async () => {
    // Two refund() calls fired in parallel against the same logId must
    // credit the user exactly once. Before the atomic-claim fix, both
    // calls would pass the SELECT-then-check guard and run the unguarded
    // UPDATE on users, doubling the credit.
    const { deduct, refund } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "free",
      creditsRemainingDaily: 500,
      creditsRemainingMonthly: 3000,
    });

    const { logId } = await deduct(userId, "generation", null);

    await Promise.all([refund(logId), refund(logId), refund(logId)]);

    const user = testDb.sqlite
      .query<
        {
          credits_remaining_daily: number;
          credits_remaining_monthly: number;
          lifetime_generations_used: number;
        },
        [string]
      >(
        `SELECT credits_remaining_daily, credits_remaining_monthly, lifetime_generations_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.credits_remaining_daily).toBe(500); // not 1500 or 1000
    expect(user?.credits_remaining_monthly).toBe(3000); // not 9000 or 6000
    expect(user?.lifetime_generations_used).toBe(0); // not negative or skipped
  });

  test("admin refund: no credits change, no lifetime change (cost was 0)", async () => {
    const { deduct, refund } = await import("../src/services/usage/charge.js");
    const { id: userId } = insertTestUser(testDb.sqlite, {
      tier: "admin",
      creditsRemainingDaily: 100,
      creditsRemainingMonthly: 100,
    });

    const { logId } = await deduct(userId, "generation", null);
    await refund(logId);

    const user = testDb.sqlite
      .query<{ credits_remaining_monthly: number; lifetime_generations_used: number }, [string]>(
        `SELECT credits_remaining_monthly, lifetime_generations_used FROM "user" WHERE id = ?`
      )
      .get(userId);
    expect(user?.credits_remaining_monthly).toBe(100);
    expect(user?.lifetime_generations_used).toBe(0);

    const log = testDb.sqlite
      .query<{ refunded_at: number | null }, [string]>(
        "SELECT refunded_at FROM usage_log WHERE id = ?"
      )
      .get(logId);
    expect(log?.refunded_at).not.toBeNull();
  });
});

describe("checkUpfront — pre-stream guard", () => {
  test("returns null when free user has lifetime budget remaining", async () => {
    const { checkUpfront } = await import("../src/services/usage/charge.js");
    const result = checkUpfront(
      {
        tier: "free",
        creditsRemainingDaily: 500,
        creditsRemainingMonthly: 3000,
        dailyResetAt: 1,
        monthlyResetAt: 1,
        lifetimeGenerationsUsed: 0,
        lifetimeRefinementsUsed: 0,
      },
      "generation"
    );
    expect(result).toBeNull();
  });

  test("returns lifetime error when free user is at the cap", async () => {
    const { checkUpfront } = await import("../src/services/usage/charge.js");
    const result = checkUpfront(
      {
        tier: "free",
        creditsRemainingDaily: 500,
        creditsRemainingMonthly: 3000,
        dailyResetAt: 1,
        monthlyResetAt: 1,
        lifetimeGenerationsUsed: 1,
        lifetimeRefinementsUsed: 0,
      },
      "generation"
    );
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("lifetime");
    expect(result?.resetAt).toBe(0);
  });

  test("returns daily error when free user has lifetime budget but hit daily cap", async () => {
    const { checkUpfront } = await import("../src/services/usage/charge.js");
    const result = checkUpfront(
      {
        tier: "free",
        creditsRemainingDaily: 0,
        creditsRemainingMonthly: 3000,
        dailyResetAt: 12345,
        monthlyResetAt: 67890,
        lifetimeGenerationsUsed: 0,
        lifetimeRefinementsUsed: 0,
      },
      "generation"
    );
    expect(result?.kind).toBe("daily");
    expect(result?.resetAt).toBe(12345);
  });

  test("admin always returns null", async () => {
    const { checkUpfront } = await import("../src/services/usage/charge.js");
    const result = checkUpfront(
      {
        tier: "admin",
        creditsRemainingDaily: 0,
        creditsRemainingMonthly: 0,
        dailyResetAt: 0,
        monthlyResetAt: 0,
        lifetimeGenerationsUsed: 999,
        lifetimeRefinementsUsed: 999,
      },
      "generation"
    );
    expect(result).toBeNull();
  });
});
