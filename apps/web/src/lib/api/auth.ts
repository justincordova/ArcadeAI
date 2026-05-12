import { queryClient } from "@/lib/query-client.js";
import type { MeResponse } from "@arcadeai/shared";
import { API_BASE } from "./client.js";

export type { MeResponse };

const API = API_BASE;

/**
 * Fetch the current user. Returns `null` on 401 so callers (route guards,
 * useSession) can treat "no session" as a normal state. Throws on 5xx
 * and on network failures so the route's error boundary can surface a
 * meaningful "service unavailable" screen rather than bouncing a logged-in
 * user to /sign-in (which then re-checks /api/me, gets 5xx again, and
 * loops forever).
 *
 * Counterpart: routes that REQUIRE auth and want to surface failure should
 * call `patchMe` / `deleteMe` from `lib/api/me.ts`, which throw on error.
 */
export async function fetchMeOrNull(): Promise<MeResponse | null> {
  const res = await fetch(`${API}/api/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) {
    // 4xx (except 401) and 5xx are real errors — surface them.
    throw new Error(`Failed to load profile (${res.status})`);
  }
  return (await res.json()) as MeResponse;
}

export async function signOut(): Promise<void> {
  await fetch(`${API}/api/auth/sign-out`, {
    method: "POST",
    credentials: "include",
  });
  // Drop every cached query before hard-navigating so a back-button to the
  // SPA doesn't briefly flash the previous user's data while the auth guard
  // re-evaluates and redirects.
  queryClient.clear();
  window.location.href = "/sign-in";
}

/**
 * Initiates a social sign-in via Better Auth.
 *
 * Better Auth exposes social sign-in as `POST /api/auth/sign-in/social` with
 * a JSON body `{ provider, callbackURL }`. The response includes `{ url }` —
 * the upstream OAuth provider URL we then navigate the browser to.
 */
export async function startSocialSignIn(provider: "google" | "github", next = "/"): Promise<void> {
  // Better Auth's OAuth callback runs on the server origin (localhost:3000)
  // and 302-redirects to `callbackURL` after exchanging the auth code. If we
  // pass a relative path here, the browser resolves it against the server
  // origin and lands on the wrong host (the API server has no UI). Build an
  // absolute URL anchored at the web origin so the user lands on the SPA.
  const callbackURL = new URL(next || "/", window.location.origin).toString();

  const res = await fetch(`${API}/api/auth/sign-in/social`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, callbackURL }),
  });
  if (!res.ok) {
    throw new Error(`Sign-in failed: ${res.status}`);
  }
  const body = (await res.json()) as { url?: string; redirect?: boolean };
  if (body.url) {
    window.location.href = body.url;
  } else {
    throw new Error("Sign-in response missing url");
  }
}
