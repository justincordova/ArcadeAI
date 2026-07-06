import { queryClient } from "@/lib/query-client.js";
import type { MeResponse } from "@arcadeai/shared";
import { API_BASE, apiFetch, toApiError } from "./client.js";

export type { MeResponse };

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
 *
 * This stays a hand-rolled fetch rather than `apiFetch` because the 401→null
 * mapping is the opposite of apiFetch's throw-on-non-2xx contract.
 */
export async function fetchMeOrNull(): Promise<MeResponse | null> {
  const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) {
    // 4xx (except 401) and 5xx are real errors — surface them with code.
    throw await toApiError(res);
  }
  return (await res.json()) as MeResponse;
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/sign-out`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Network failure — proceed anyway. Callers fire-and-forget this
    // (TopBar's onClick), so an uncaught rejection here meant the click
    // silently did NOTHING: no cache clear, no navigation, and the user
    // believed they were signed out. Clearing local state and landing on
    // /sign-in is the right UX even if the server never saw the request;
    // if the session cookie survived, the sign-in flow makes that visible.
  }
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

  const body = await apiFetch<{ url?: string; redirect?: boolean }>("/api/auth/sign-in/social", {
    method: "POST",
    json: { provider, callbackURL },
  });
  if (body.url) {
    window.location.href = body.url;
  } else {
    throw new Error("Sign-in response missing url");
  }
}
