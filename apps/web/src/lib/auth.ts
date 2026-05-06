const API = "http://localhost:3000";

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  tier: string;
}

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

export function getSignInUrl(provider: "google" | "github", next = "/"): string {
  const callbackURL = encodeURIComponent(next);
  return `${API}/api/auth/sign-in/${provider}?callbackURL=${callbackURL}`;
}
