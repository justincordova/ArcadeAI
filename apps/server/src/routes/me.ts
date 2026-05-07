import type { FastifyInstance } from "fastify";
import { applyResets } from "../services/usage/reset.js";

export async function meRoutes(app: FastifyInstance) {
  app.get("/api/me", async (request, reply) => {
    const { user } = request.authSession;
    const u = user as Record<string, unknown>;
    const userId = user.id;

    // Apply lazy resets and return fresh counters
    const counters = await applyResets(userId);

    const tier = (u.tier ?? "free") as string;
    const theme = (u.theme ?? "dark") as string;

    return reply.send({
      id: userId,
      email: user.email,
      displayName: u.displayName ?? user.name ?? "",
      tier,
      theme,
      creditsRemainingDaily: counters?.creditsRemainingDaily ?? 0,
      creditsRemainingMonthly: counters?.creditsRemainingMonthly ?? 0,
      dailyResetAt: counters?.dailyResetAt ?? 0,
      monthlyResetAt: counters?.monthlyResetAt ?? 0,
    });
  });
}
