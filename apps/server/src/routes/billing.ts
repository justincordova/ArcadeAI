// Billing routes: plan/tier changes and the resulting credit-limit resets.
// No real payment processor is wired up (SPEC §10) — see change-plan below
// for how the prototype caps balances on upgrade/downgrade.
import { accounts, users } from "@arcadeai/db";
import { TIER_CREDIT_LIMITS } from "@arcadeai/shared";
import type { LinkedProvider, Theme } from "@arcadeai/shared";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { notFoundError, sendError, validationError } from "../lib/errors.js";
import { applyResets, nextUtcMidnight, nextUtcMonthStart } from "../services/usage/reset.js";

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

    // Apply any pending lazy credit reset BEFORE reading the tier/credits.
    // Reading the row directly (as this route used to) could see a stale,
    // depleted balance with a past reset boundary — the plan change would
    // then cap against last period's leftover and silently consume the
    // refill the user was owed. applyResets returns the canonical tier and
    // post-reset counters. (See AGENTS.md: never read credits without it.)
    const current = await applyResets(user.id);
    if (!current) {
      // User row deleted between auth-guard and this read — possible if the
      // user deleted their account in another tab. Treat as 404.
      return sendError(reply, 404, notFoundError("User not found"));
    }

    // Admin tier cannot be changed via billing. Use the DB tier (from
    // applyResets), not the session payload, which may be stale.
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
    // We cap the balance on downgrade until real billing is in place. The
    // MIN is computed inside the UPDATE statement (not read-then-write in
    // JS) so it's atomic against a concurrent deduct(): a generation that
    // decrements credits between our read and write can no longer be
    // clobbered by a blind absolute write that restores the spent balance.
    await db
      .update(users)
      .set({
        tier,
        creditsRemainingMonthly: sql`MIN(${users.creditsRemainingMonthly}, ${limits.monthly})`,
        creditsRemainingDaily: sql`MIN(${users.creditsRemainingDaily}, ${limits.daily})`,
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
