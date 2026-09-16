import { users } from "@arcadeai/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "../lib/db.js";
import { sendError, unauthorizedError } from "../lib/errors.js";
import { guardPath } from "../lib/guard-path.js";
import { getSupabaseSession, type SupabaseSession } from "../lib/supabase-auth.js";

export async function getSession(request: FastifyRequest): Promise<SupabaseSession | null> {
  return getSupabaseSession(request.headers.authorization);
}

/** Gate private API routes with a verified Supabase bearer token. */
export function registerAuthGuard(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const path = guardPath(request);
    if (
      !path.startsWith("/api/") ||
      path === "/api/health" ||
      path === "/api/config" ||
      path.startsWith("/api/play/") ||
      path === "/api/discover" ||
      path.startsWith("/api/og/")
    )
      return;

    try {
      const session = await getSupabaseSession(request.headers.authorization);
      if (!session) return sendError(reply, 401, unauthorizedError());
      const now = Date.now();
      await db
        .insert(users)
        .values({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          displayName: session.user.name,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      request.authSession = session;
    } catch {
      return sendError(reply, 401, unauthorizedError());
    }
  });
}

// Auth routes are served by Supabase rather than this Fastify process.
export async function authPlugin(_app: FastifyInstance): Promise<void> {}
