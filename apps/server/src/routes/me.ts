import { accounts, games, sessions, usageLog, users } from "@arcadeai/db";
import type { LinkedProvider, MeResponse, Theme } from "@arcadeai/shared";
import { eq, sql } from "drizzle-orm";
// SPEC §11, §12, §14: /api/me GET, PATCH, DELETE
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { notFoundError, sendError, validationError } from "../lib/errors.js";
import { toWebHeaders } from "../plugins/auth.js";
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
    lifetimeGenerationsUsed: user.lifetimeGenerationsUsed,
    lifetimeRefinementsUsed: user.lifetimeRefinementsUsed,
    linkedProviders,
  };
}

export async function meRoutes(app: FastifyInstance) {
  // GET /api/me
  app.get("/api/me", async (request, reply) => {
    const userId = request.authSession.user.id;
    const me = await loadMe(userId);
    if (!me) return sendError(reply, 404, notFoundError("User not found"));
    return reply.send(me);
  });

  // PATCH /api/me — update display_name and/or theme (SPEC §11)
  app.patch("/api/me", async (request, reply) => {
    const parseResult = PatchMeBody.safeParse(request.body);
    if (!parseResult.success) {
      return sendError(
        reply,
        400,
        validationError("Validation error", { issues: parseResult.error.issues })
      );
    }

    const userId = request.authSession.user.id;
    const { display_name, theme } = parseResult.data;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (display_name !== undefined) update.displayName = display_name;
    if (theme !== undefined) update.theme = theme;

    await db.update(users).set(update).where(eq(users.id, userId));

    const me = await loadMe(userId);
    if (!me) return sendError(reply, 404, notFoundError("User not found"));
    return reply.send(me);
  });

  // DELETE /api/me — permanently delete account and all data (SPEC §11, §12)
  app.delete("/api/me", async (request, reply) => {
    const userId = request.authSession.user.id;

    // Sign the user out FIRST so Better Auth has a chance to clear its own
    // session-cookie state cleanly (cookie attrs, sameSite policies). The
    // transaction below also deletes the session row as defense-in-depth,
    // but going through Better Auth keeps any future audit/event hooks fed.
    try {
      // Must be a real WHATWG Headers object — Better Auth reads the session
      // cookie via headers.get(). The previous `request.headers as unknown as
      // Headers` cast handed it a plain Node object with no .get(), so the
      // cookie lookup failed and this call never actually signed out.
      await auth.api.signOut({ headers: toWebHeaders(request) });
    } catch (err) {
      request.log.warn({ err }, "auth.api.signOut failed during account delete; continuing");
    }

    // Synchronous callback so Drizzle's bun-sqlite driver wraps all five
    // deletes in one real transaction. An `async` callback would commit at the
    // first `await`, so a failure on a later delete would leave the account
    // half-deleted (e.g. games/logs gone but user/accounts/sessions remaining).
    db.transaction((tx) => {
      // Decrement like_count on OTHER users' games this user had liked, BEFORE
      // deleting the user. Deleting the user cascades away their game_likes
      // rows (gameLikes.userId ON DELETE cascade), but that cascade does NOT
      // touch the denormalized games.like_count — so without this the counter
      // permanently overstates reality and the Discover ranking drifts. Must
      // run before delete(users) so the rows still exist. Games the user owned
      // are deleted below anyway, so the decrement on those is harmless.
      tx.run(
        sql`UPDATE games SET like_count = MAX(like_count - 1, 0)
            WHERE id IN (SELECT game_id FROM game_likes WHERE user_id = ${userId})`
      );

      // Cascade order: delete owned game data, then logs, then auth rows, then user
      tx.delete(games).where(eq(games.userId, userId)).run();
      tx.delete(usageLog).where(eq(usageLog.userId, userId)).run();
      tx.delete(sessions).where(eq(sessions.userId, userId)).run();
      tx.delete(accounts).where(eq(accounts.userId, userId)).run();
      tx.delete(users).where(eq(users.id, userId)).run();
    });

    return reply.status(204).send();
  });
}
