import { createRemoteJWKSet, jwtVerify } from "jose";

export interface SupabaseSession {
  user: {
    id: string;
    email: string;
    name: string;
  };
}

const supabaseUrl = process.env.SUPABASE_URL;
const jwksUrl =
  process.env.SUPABASE_JWKS_URL ??
  (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : undefined);
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;

export async function getSupabaseSession(
  authorization: string | undefined
): Promise<SupabaseSession | null> {
  if (!jwks || !supabaseUrl) return null;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${supabaseUrl}/auth/v1`,
    audience: "authenticated",
  });
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;

  const metadata = payload.user_metadata as { name?: unknown } | undefined;
  const name =
    metadata && typeof metadata.name === "string" ? metadata.name : payload.email.split("@")[0];

  return { user: { id: payload.sub, email: payload.email, name } };
}
