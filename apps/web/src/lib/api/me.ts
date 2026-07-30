import type { MeResponse, Theme } from "@arcadeai/shared";
import { apiFetch } from "./client.js";

// Note: the read path lives at lib/api/auth.ts:fetchMeOrNull (returns null on
// 401). Mutations below throw an ApiError on failure — they're called from
// authed contexts where surfacing failure (and its `code`) is correct.

export async function patchMe(body: { display_name?: string; theme?: Theme }): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/me", { method: "PATCH", json: body });
}

export async function deleteMe(): Promise<void> {
  // No payload — apiFetch sends the CSRF-required empty "{}" body for us.
  await apiFetch<void>("/api/me", { method: "DELETE" });
}

/**
 * Begin linking an additional OAuth provider to the current account.
 *
 * Better Auth exposes linking ONLY as `POST /link-social` with a JSON body; it
 * has no `GET /link/:provider`. This used to build that non-existent URL and
 * navigate to it directly, which left the user on the API origin looking at a
 * raw 404 with account linking entirely non-functional.
 *
 * `disableRedirect` keeps the response a plain JSON `{ url }` instead of also
 * setting a Location header, so the caller owns the navigation.
 */
export async function linkProvider(
  provider: "google" | "github",
  callbackURL: string
): Promise<string> {
  const res = await apiFetch<{ url: string }>("/api/auth/link-social", {
    method: "POST",
    json: { provider, callbackURL, disableRedirect: true },
  });
  return res.url;
}

/**
 * Disconnect a linked OAuth provider via Better Auth's unlink endpoint.
 * The server-side last-provider guard (SPEC §11) is enforced separately —
 * this just hits the Better Auth route. Better Auth returns a non-2xx if
 * unlinking would leave the user with no auth method.
 */
export async function unlinkProvider(provider: "google" | "github"): Promise<void> {
  await apiFetch<void>("/api/auth/unlink-account", {
    method: "POST",
    json: { providerId: provider },
  });
}
