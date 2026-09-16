import type { SupabaseSession } from "../lib/supabase-auth.js";

export type AuthSession = SupabaseSession;

// Extend FastifyRequest type with authSession
declare module "fastify" {
  interface FastifyRequest {
    authSession: AuthSession;
  }
}
