import type { MeResponse, Theme } from "@arcadeai/shared";
import { API_BASE } from "./client.js";

const API = API_BASE;

// Note: the read path lives at lib/api/auth.ts:fetchMeOrNull (returns null on
// 401). Mutations below throw on error — they're called from authed contexts
// where surfacing failure is correct.

export async function patchMe(body: { display_name?: string; theme?: Theme }): Promise<MeResponse> {
  const res = await fetch(`${API}/api/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update profile");
  return res.json() as Promise<MeResponse>;
}

export async function deleteMe(): Promise<void> {
  const res = await fetch(`${API}/api/me`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete account");
}

export function linkProviderUrl(provider: "google" | "github"): string {
  return `${API}/api/auth/link/${provider}`;
}
