import type { MeResponse } from "@arcadeai/shared";

export type { MeResponse };

const API = "http://localhost:3000";

export async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetch(`${API}/api/me`, { credentials: "include" });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    return res.json() as Promise<MeResponse>;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  await fetch(`${API}/api/auth/sign-out`, {
    method: "POST",
    credentials: "include",
  });
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
  const res = await fetch(`${API}/api/auth/sign-in/social`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, callbackURL: next }),
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
