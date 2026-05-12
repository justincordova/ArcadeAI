import { accounts, users } from "@arcadeai/db";
import { TIER_CREDIT_LIMITS } from "@arcadeai/shared";
import type { LinkedProvider, Theme } from "@arcadeai/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { notFoundError, sendError, validationError } from "../lib/errors.js";
import { nextUtcMidnight, nextUtcMonthStart } from "../services/usage/reset.js";

const ChangePlanBody = z.object({
  tier: z.enum(["free", "creator", "pro"]),
  interval: z.enum(["monthly", "yearly"]),
});

export async function billingRoutes(app: FastifyInstance) {
  // POST /api/billing/change-plan — update user tier and reset credits
  // interval is validated but not stored (prototype; structured for Stripe webhook future)
  app.post("/api/billing/change-plan", async (request, reply) => {
    const parseResult = ChangePlanBody.safeParse(request.body);
    if (!parseResult.success) {
      return sendError(
        reply,
        400,
        validationError("Validation error", { issues: parseResult.error.issues })
      );
    }

    const { tier } = parseResult.data;
    const { user } = request.authSession;

    // Read tier from the DB, not the session payload. The Better Auth
    // session caches `user.tier` from the time the session was issued —
    // if the row changed since (e.g. via a previous call to this very
    // route, or a manual SQL adjustment), the cached value is stale and
    // the admin-bypass guard below would let an admin's tier be changed.
    const currentRows = await db
      .select({
        tier: users.tier,
        creditsRemainingDaily: users.creditsRemainingDaily,
        creditsRemainingMonthly: users.creditsRemainingMonthly,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const current = currentRows[0];
    if (!current) {
      // User row deleted between auth-guard and this read — possible if the
      // user deleted their account in another tab. Treat as 404.
      return sendError(reply, 404, notFoundError("User not found"));
    }

    // Admin tier cannot be changed via billing
    if (current.tier === "admin") {
      return sendError(reply, 400, validationError("Admin tier cannot be changed via billing"));
    }

    const now = Date.now();
    const dailyResetAt = nextUtcMidnight(now);
    const monthlyResetAt = nextUtcMonthStart(now);
    const limits = TIER_CREDIT_LIMITS[tier];

    // In a real-billing world (post-Stripe), downgrade preserves the
    // existing balance until the next monthly boundary so a user who
    // legitimately paid for credits isn't punished for unspent balance.
    //
    // In the prototype there is no payment ledger — "credits I already
    // had" is indistinguishable from "credits I minted by upgrading
    // free → creator (free of charge) and then downgrading back." That
    // round-trip would leave a free-tier user with creator-tier credit
    // balance, spendable the moment ENFORCE_LIFETIME_LIMITS_FOR_FREE
    // flips off.
    //
    // We cap the balance on downgrade until real billing is in place
    // and we can verify the source of the credit. Restore the original
    // SPEC §10 preserve-on-downgrade behavior alongside the Stripe
    // integration.
    const nextMonthly = Math.min(current.creditsRemainingMonthly, limits.monthly);
    const nextDaily = Math.min(current.creditsRemainingDaily, limits.daily);

    await db
      .update(users)
      .set({
        tier,
        creditsRemainingMonthly: nextMonthly,
        creditsRemainingDaily: nextDaily,
        monthlyResetAt,
        dailyResetAt,
        updatedAt: new Date(now),
      })
      .where(eq(users.id, user.id));

    // Reload the full user row so we return the same shape GET /api/me
    // does — including lifetime counters and linked providers. Without
    // these fields, the client's setQueryData(["me"], response) wipes
    // them from cache and the pricing/usage UI shows undefined.
    const fresh = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const u = fresh[0];
    if (!u) return sendError(reply, 404, notFoundError("User not found"));

    const accountRows = await db
      .select({ providerId: accounts.providerId })
      .from(accounts)
      .where(eq(accounts.userId, user.id));
    const linkedProviders = accountRows
      .map((r) => r.providerId)
      .filter((p): p is LinkedProvider => p === "google" || p === "github");

    return reply.send({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      tier: u.tier,
      theme: (u.theme as Theme) ?? "dark",
      creditsRemainingDaily: u.creditsRemainingDaily,
      creditsRemainingMonthly: u.creditsRemainingMonthly,
      dailyResetAt: u.dailyResetAt,
      monthlyResetAt: u.monthlyResetAt,
      lifetimeGenerationsUsed: u.lifetimeGenerationsUsed,
      lifetimeRefinementsUsed: u.lifetimeRefinementsUsed,
      linkedProviders,
    });
  });
}
