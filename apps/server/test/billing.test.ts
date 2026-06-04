// Integration tests for the billing change-plan route via app.inject().
// Mirrors games-routes.test.ts: mock the DB module, inject a stub auth
// session through a preHandler hook so the real handler runs end-to-end.
//
// Focus: the credit-cap must be computed atomically inside the UPDATE
// (MIN in SQL), not read-then-write in JS — otherwise a concurrent deduct()
// that fires between the read and the write is clobbered, restoring spent
// credits (a credit-minting race). We also cover the applyResets integration
// (a pending lazy reset must be granted, not consumed).

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import { type TestDb, createTestDb, insertTestUser } from "./test-db.js";

let testDb: TestDb;
let app: FastifyInstance;
let stubUserId = "user-stub";

async function buildApp() {
  const fastify = Fastify({ logger: false });
  fastify.addHook("preHandler", async (request) => {
    (request as unknown as { authSession: { user: { id: string } } }).authSession = {
      user: { id: stubUserId },
    };
  });
  const { billingRoutes } = await import("../src/routes/billing.js");
  await fastify.register(billingRoutes);
  return fastify;
}

beforeEach(async () => {
  testDb = createTestDb();
  mock.module("../src/lib/db.ts", () => ({
    db: testDb.db,
    sqlite: testDb.sqlite,
  }));
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  testDb.close();
});

function readCredits(userId: string) {
  return testDb.sqlite
    .query<
      { credits_remaining_daily: number; credits_remaining_monthly: number; tier: string },
      [string]
    >(`SELECT credits_remaining_daily, credits_remaining_monthly, tier FROM "user" WHERE id = ?`)
    .get(userId);
}

describe("POST /api/billing/change-plan — credit cap", () => {
  test("caps balance to the new tier limit on downgrade", async () => {
    stubUserId = "user-cap";
    insertTestUser(testDb.sqlite, {
      id: stubUserId,
      tier: "pro",
      creditsRemainingDaily: 5000,
      creditsRemainingMonthly: 50000,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/billing/change-plan",
      headers: { "content-type": "application/json" },
      payload: { tier: "free", interval: "monthly" },
    });

    expect(res.statusCode).toBe(200);
    const u = readCredits(stubUserId);
    // Free tier limits are 500 daily / 3000 monthly — balance capped down.
    expect(u?.credits_remaining_daily).toBe(500);
    expect(u?.credits_remaining_monthly).toBe(3000);
    expect(u?.tier).toBe("free");
  });

  test("does not raise a balance already below the new tier limit", async () => {
    stubUserId = "user-nolift";
    insertTestUser(testDb.sqlite, {
      id: stubUserId,
      tier: "free",
      creditsRemainingDaily: 120,
      creditsRemainingMonthly: 800,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/billing/change-plan",
      headers: { "content-type": "application/json" },
      payload: { tier: "creator", interval: "monthly" },
    });

    expect(res.statusCode).toBe(200);
    const u = readCredits(stubUserId);
    // MIN(current, limit) keeps the lower current balance — no free top-up.
    expect(u?.credits_remaining_daily).toBe(120);
    expect(u?.credits_remaining_monthly).toBe(800);
    expect(u?.tier).toBe("creator");
  });

  test("a concurrent deduct between read and write is not clobbered", async () => {
    // Regression for the credit-minting race: the handler used to SELECT,
    // compute MIN in JS, then blind-UPDATE an absolute value. A deduct that
    // committed in between was overwritten, restoring the spent credits.
    // With MIN computed inside the UPDATE the deduct survives.
    stubUserId = "user-race";
    insertTestUser(testDb.sqlite, {
      id: stubUserId,
      tier: "creator",
      creditsRemainingDaily: 5000,
      creditsRemainingMonthly: 20000,
    });

    const { deduct } = await import("../src/services/usage/charge.js");

    // Fire the plan change and a generation deduct (200 credits) concurrently.
    const [planRes] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/billing/change-plan",
        headers: { "content-type": "application/json" },
        payload: { tier: "creator", interval: "monthly" },
      }),
      deduct(stubUserId, "generation", null),
    ]);

    expect(planRes.statusCode).toBe(200);

    const u = readCredits(stubUserId);
    // The deduct charged 200. Final monthly balance must reflect that charge
    // (<= 20000 - 200), never be restored to the pre-deduct 20000. Because
    // MIN(balance, 20000) is evaluated atomically against whatever the
    // balance is at write time, the deduction is preserved.
    expect(u?.credits_remaining_monthly).toBeLessThanOrEqual(19800);
  });
});

describe("POST /api/billing/change-plan — applyResets integration", () => {
  test("grants a pending monthly reset before capping", async () => {
    stubUserId = "user-reset";
    // monthlyResetAt in the past → a lazy reset is owed. Stored balance is
    // depleted; applyResets should refill to the tier limit first.
    insertTestUser(testDb.sqlite, {
      id: stubUserId,
      tier: "creator",
      creditsRemainingDaily: 0,
      creditsRemainingMonthly: 50,
      dailyResetAt: Date.now() - 1000,
      monthlyResetAt: Date.now() - 1000,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/billing/change-plan",
      headers: { "content-type": "application/json" },
      payload: { tier: "creator", interval: "monthly" },
    });

    expect(res.statusCode).toBe(200);
    const u = readCredits(stubUserId);
    // Creator monthly limit is 20000; the owed refill is granted, not consumed
    // by the plan change capping against the stale depleted balance.
    expect(u?.credits_remaining_monthly).toBe(20000);
  });
});

describe("POST /api/billing/change-plan — guards", () => {
  test("rejects an invalid tier with 400", async () => {
    stubUserId = "user-bad";
    insertTestUser(testDb.sqlite, { id: stubUserId });
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/change-plan",
      headers: { "content-type": "application/json" },
      payload: { tier: "enterprise", interval: "monthly" },
    });
    expect(res.statusCode).toBe(400);
  });

  test("refuses to change an admin tier", async () => {
    stubUserId = "user-admin";
    insertTestUser(testDb.sqlite, { id: stubUserId, tier: "admin" });
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/change-plan",
      headers: { "content-type": "application/json" },
      payload: { tier: "free", interval: "monthly" },
    });
    expect(res.statusCode).toBe(400);
  });
});
