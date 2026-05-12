import { API_BASE } from "./client.js";

const API = API_BASE;

export interface GameSummary {
  id: string;
  title: string;
  thumbnail: string | null;
  updatedAt: number;
  createdAt: number;
  isPublic: boolean;
  publicSlug: string | null;
  genre: string | null;
}

export interface PublicGame {
  id: string;
  title: string;
  currentCode: string;
  originalPrompt: string;
  ownerDisplayName: string;
  publishedAt: number | null;
  genre: string | null;
  likeCount: number;
  playCount: number;
  liked: boolean;
}

export interface PublishResponse {
  slug: string;
  isPublic: boolean;
  publishedAt: number;
}

export interface RemixResponse {
  id: string;
  title: string;
  remixedFromGameId: string;
}

export const GAMES_QUERY_KEY = ["games"] as const;

export interface GameDetail {
  id: string;
  title: string;
  currentCode: string;
  messages: Array<{ id: string; kind: string; content: string; createdAt: number }>;
}

export async function listGames(): Promise<GameSummary[]> {
  const res = await fetch(`${API}/api/games`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch games");
  return res.json() as Promise<GameSummary[]>;
}

export async function fetchGame(id: string): Promise<GameDetail> {
  const res = await fetch(`${API}/api/games/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Game not found");
  return res.json() as Promise<GameDetail>;
}

export async function patchGame(id: string, update: { title: string }): Promise<GameSummary> {
  const res = await fetch(`${API}/api/games/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error("Failed to rename game");
  return res.json() as Promise<GameSummary>;
}

export async function deleteGame(id: string): Promise<void> {
  const res = await fetch(`${API}/api/games/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete game");
}

export async function postThumbnail(id: string, dataUrl: string): Promise<void> {
  const res = await fetch(`${API}/api/games/${id}/thumbnail`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thumbnail: dataUrl }),
  });
  if (!res.ok) throw new Error("Failed to save thumbnail");
}

// ── Public sharing ───────────────────────────────────────────────────────────

export async function publishGame(id: string): Promise<PublishResponse> {
  const res = await fetch(`${API}/api/games/${id}/publish`, {
    method: "POST",
    credentials: "include",
    // Empty JSON body keeps the CSRF guard happy (state-changing /api/*
    // requests must declare application/json; see plugins/csrf.ts).
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error("Failed to publish game");
  return res.json() as Promise<PublishResponse>;
}

export async function unpublishGame(id: string): Promise<void> {
  const res = await fetch(`${API}/api/games/${id}/unpublish`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error("Failed to unpublish game");
}

/**
 * Fetch a public game by slug. Returns null on 404 so callers can render
 * a "not found" state cleanly instead of catching exceptions.
 */
export async function fetchPublicGame(slug: string): Promise<PublicGame | null> {
  const res = await fetch(`${API}/api/play/${slug}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to load public game");
  return res.json() as Promise<PublicGame>;
}

// Empty-body POSTs need a literal "{}" payload when Content-Type is set
// to application/json — Fastify's default JSON parser rejects an empty
// body as "Body cannot be empty when content-type is set to
// 'application/json'". The CSRF guard requires the JSON content-type
// (csrf.ts) for state-changing requests, so we can't drop the header.

/** Fire-and-forget play counter. Failures are silently ignored. */
export function recordPlay(slug: string): void {
  fetch(`${API}/api/play/${slug}/play`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {
    /* silent */
  });
}

export interface LikeResponse {
  liked: boolean;
  changed: boolean;
  likeCount: number;
}

export async function likeGame(slug: string): Promise<LikeResponse> {
  const res = await fetch(`${API}/api/play/${slug}/like`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) throw new Error("Sign in to like");
  if (!res.ok) throw new Error("Failed to like game");
  return res.json() as Promise<LikeResponse>;
}

export async function unlikeGame(slug: string): Promise<LikeResponse> {
  const res = await fetch(`${API}/api/play/${slug}/like`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) throw new Error("Sign in to like");
  if (!res.ok) throw new Error("Failed to unlike game");
  return res.json() as Promise<LikeResponse>;
}

// Discover listing
export interface DiscoverGame {
  id: string;
  slug: string;
  title: string;
  thumbnail: string | null;
  originalPrompt: string;
  ownerDisplayName: string;
  genre: string | null;
  publishedAt: number | null;
  playCount: number;
  likeCount: number;
  liked: boolean;
}

export interface DiscoverPage {
  items: DiscoverGame[];
  nextOffset: number | null;
}

export type DiscoverSort = "trending" | "top" | "new";

export async function fetchDiscover(params: {
  sort: DiscoverSort;
  genre?: string | null;
  limit?: number;
  offset?: number;
}): Promise<DiscoverPage> {
  const search = new URLSearchParams();
  search.set("sort", params.sort);
  if (params.genre) search.set("genre", params.genre);
  if (params.limit) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));

  const res = await fetch(`${API}/api/discover?${search.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load discover");
  return res.json() as Promise<DiscoverPage>;
}

export async function remixPublicGame(slug: string): Promise<RemixResponse> {
  const res = await fetch(`${API}/api/play/${slug}/remix`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) {
    throw new Error("Sign in to remix");
  }
  if (res.status === 402) {
    // Server returns the new ApiError shape: { code, message, details: { kind, resetAt } }.
    // The old shape ({ kind, resetAt } at top level) is normalized by reading
    // either path so a stale build can't break this gracefully-degraded UX.
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const details = (raw.details as Record<string, unknown> | undefined) ?? raw;
    const kind = details.kind as string | undefined;
    const resetAt = typeof details.resetAt === "number" ? details.resetAt : undefined;
    const code = raw.code as string | undefined;
    if (code === "FREE_TIER_EXHAUSTED" || kind === "lifetime" || resetAt === 0) {
      throw new Error("You've used your free trial. Upgrade for more remixes.");
    }
    throw new Error("Out of credits — upgrade for more remixes.");
  }
  if (!res.ok) throw new Error("Failed to remix game");
  return res.json() as Promise<RemixResponse>;
}
