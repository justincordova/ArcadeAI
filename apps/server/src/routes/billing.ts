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

    // Per SPEC §10: on plan change, reset both counters to new tier's allotments.
    // For paid tiers, dailyEnforced=false but we still initialize daily counter
    // to the tier's daily value for observability parity.
    await db
      .update(users)
      .set({
        tier,
        creditsRemainingMonthly: limits.monthly,
        creditsRemainingDaily: limits.daily,
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
      creditsRemainingDaily: limits.daily,
      creditsRemainingMonthly: limits.monthly,
      dailyResetAt,
      monthlyResetAt,
    });
  });
}
