import type { auth } from "../lib/auth.js";

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

// Extend FastifyRequest type with authSession
declare module "fastify" {
  interface FastifyRequest {
    authSession: AuthSession;
  }
}
