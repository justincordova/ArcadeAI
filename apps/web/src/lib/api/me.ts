import type { MeResponse, Theme } from "@arcadeai/shared";
import { API_BASE, apiFetch } from "./client.js";

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

export function linkProviderUrl(provider: "google" | "github"): string {
  return `${API_BASE}/api/auth/link/${provider}`;
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
