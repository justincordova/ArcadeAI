import { users } from "@arcadeai/db";
import { TIER_CREDIT_LIMITS } from "@arcadeai/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { sendError, validationError } from "../lib/errors.js";
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
    const u = user as Record<string, unknown>;
    const currentTier = (u.tier ?? "free") as string;

    // Admin tier cannot be changed via billing
    if (currentTier === "admin") {
      return sendError(reply, 400, validationError("Admin tier cannot be changed via billing"));
    }

    const now = Date.now();
    const dailyResetAt = nextUtcMidnight(now);
    const monthlyResetAt = nextUtcMonthStart(now);
    const limits = TIER_CREDIT_LIMITS[tier];

    // Read current balance so the downgrade rule (#46) can preserve it. The
    // user table is the source of truth; credits_remaining_* live there.
    const currentRows = await db
      .select({
        creditsRemainingDaily: users.creditsRemainingDaily,
        creditsRemainingMonthly: users.creditsRemainingMonthly,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    // biome-ignore lint/style/noNonNullAssertion: authSession guarantees the row exists
    const current = currentRows[0]!;

    // SPEC §10 + plan #46: an UPGRADE bumps to the new tier's allotment
    // immediately so paid users get the credits they paid for. A DOWNGRADE
    // preserves the existing balance until the next monthly boundary —
    // capping to the lower tier's monthly limit would punish the user for
    // unspent credit they already legitimately had.
    const isDowngrade = current.creditsRemainingMonthly > limits.monthly;
    const nextMonthly = isDowngrade ? current.creditsRemainingMonthly : limits.monthly;
    const isDowngradeDaily = current.creditsRemainingDaily > limits.daily;
    const nextDaily = isDowngradeDaily ? current.creditsRemainingDaily : limits.daily;

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

    // Return shape matching GET /api/me so client can setQueryData(['me'], response)
    return reply.send({
      id: user.id,
      email: user.email,
      displayName: u.displayName ?? user.name ?? "",
      tier,
      theme: (u.theme ?? "dark") as string,
      creditsRemainingDaily: nextDaily,
      creditsRemainingMonthly: nextMonthly,
      dailyResetAt,
      monthlyResetAt,
    });
  });
}
