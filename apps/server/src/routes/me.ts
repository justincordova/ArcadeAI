import { accounts, games, sessions, usageLog, users } from "@arcadeai/db";
import type { LinkedProvider, MeResponse, Theme } from "@arcadeai/shared";
import { eq } from "drizzle-orm";
// SPEC §11, §12, §14: /api/me GET, PATCH, DELETE
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { applyResets } from "../services/usage/reset.js";

const PatchMeBody = z
  .object({
    display_name: z.string().trim().min(1).max(80).optional(),
    theme: z.enum(["dark", "light", "system"]).optional(),
  })
  .refine((d) => d.display_name !== undefined || d.theme !== undefined, {
    message: "At least one field required",
  });

/**
 * Load the full MeResponse shape for a user. Used by GET and PATCH to return
 * a uniform response body (SPEC §11).
 */
async function loadMe(userId: string): Promise<MeResponse | null> {
  const counters = await applyResets(userId);
  if (!counters) return null;

  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const accountRows = await db
    .select({ providerId: accounts.providerId })
    .from(accounts)
    .where(eq(accounts.userId, userId));

  const linkedProviders = accountRows
    .map((r) => r.providerId)
    .filter((p): p is LinkedProvider => p === "google" || p === "github");

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    tier: user.tier as MeResponse["tier"],
    theme: (user.theme as Theme) ?? "dark",
    creditsRemainingDaily: counters.creditsRemainingDaily,
    creditsRemainingMonthly: counters.creditsRemainingMonthly,
    dailyResetAt: counters.dailyResetAt,
    monthlyResetAt: counters.monthlyResetAt,
    linkedProviders,
  };
}

export async function meRoutes(app: FastifyInstance) {
  // GET /api/me
  app.get("/api/me", async (request, reply) => {
    const userId = request.authSession.user.id;
    const me = await loadMe(userId);
    if (!me) return reply.status(404).send({ error: "User not found" });
    return reply.send(me);
  });

  // PATCH /api/me — update display_name and/or theme (SPEC §11)
  app.patch("/api/me", async (request, reply) => {
    const parseResult = PatchMeBody.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        issues: parseResult.error.issues,
      });
    }

    const userId = request.authSession.user.id;
    const { display_name, theme } = parseResult.data;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (display_name !== undefined) update.displayName = display_name;
    if (theme !== undefined) update.theme = theme;

    await db.update(users).set(update).where(eq(users.id, userId));

    const me = await loadMe(userId);
    if (!me) return reply.status(404).send({ error: "User not found" });
    return reply.send(me);
  });

  // DELETE /api/me — permanently delete account and all data (SPEC §11, §12)
  app.delete("/api/me", async (request, reply) => {
    const userId = request.authSession.user.id;

    await db.transaction(async (tx) => {
      // Cascade order: delete owned game data, then logs, then auth rows, then user
      await tx.delete(games).where(eq(games.userId, userId));
      await tx.delete(usageLog).where(eq(usageLog.userId, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx.delete(accounts).where(eq(accounts.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });

    // The session row is deleted in the transaction above, so any subsequent
    // request with the stale cookie will fail auth and land on /sign-in.
    // The client navigates to /sign-in immediately after receiving 204, so no
    // further action is needed here.
    return reply.status(204).send();
  });
}
