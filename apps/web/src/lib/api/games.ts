import { API_BASE, ApiError, apiFetch } from "./client.js";

export interface GameSummary {
  id: string;
  title: string;
  /** Whether a thumbnail exists. The bytes are loaded lazily by reference
   *  from GET /api/games/:id/thumbnail.png — not shipped inline in the list. */
  hasThumbnail: boolean;
  updatedAt: number;
  createdAt: number;
  isPublic: boolean;
  publicSlug: string | null;
  genre: string | null;
}

/** URL for a game's thumbnail image, served owner-scoped (cookie auth). */
export function gameThumbnailUrl(id: string): string {
  return `${API_BASE}/api/games/${id}/thumbnail.png`;
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
  isPublic: boolean;
  publicSlug: string | null;
  messages: Array<{ id: string; kind: string; content: string; createdAt: number }>;
  /**
   * True while a generation is still streaming server-side (user
   * navigated away mid-stream and came back). The /game/:id page polls
   * the endpoint while this is true and shows a generating indicator
   * until current_code is populated.
   */
  inProgress: boolean;
  /** True when the last refinement/repair can be undone (single-level). */
  canUndo: boolean;
}

export async function listGames(): Promise<GameSummary[]> {
  return apiFetch<GameSummary[]>("/api/games");
}

export async function fetchGame(id: string): Promise<GameDetail> {
  return apiFetch<GameDetail>(`/api/games/${id}`);
}

export async function patchGame(
  id: string,
  update: { title: string }
): Promise<{ id: string; title: string; updatedAt: number }> {
  return apiFetch<{ id: string; title: string; updatedAt: number }>(`/api/games/${id}`, {
    method: "PATCH",
    json: update,
  });
}

export async function deleteGame(id: string): Promise<void> {
  // No payload — apiFetch supplies the CSRF-required empty "{}" body.
  await apiFetch<void>(`/api/games/${id}`, { method: "DELETE" });
}

export interface UndoResponse {
  currentCode: string;
  canUndo: boolean;
}

/**
 * Single-level undo of the last refinement/repair. Restores the pre-refinement
 * code server-side and returns it. Throws an ApiError with status 409 when
 * there is nothing to undo (never refined, or the slot was already consumed).
 */
export async function undoRefinement(id: string): Promise<UndoResponse> {
  return apiFetch<UndoResponse>(`/api/games/${id}/undo`, { method: "POST" });
}

export async function postThumbnail(id: string, dataUrl: string): Promise<void> {
  await apiFetch<void>(`/api/games/${id}/thumbnail`, {
    method: "POST",
    json: { thumbnail: dataUrl },
  });
}

// ── Public sharing ───────────────────────────────────────────────────────────

export async function publishGame(id: string): Promise<PublishResponse> {
  return apiFetch<PublishResponse>(`/api/games/${id}/publish`, { method: "POST" });
}

export async function unpublishGame(id: string): Promise<void> {
  await apiFetch<void>(`/api/games/${id}/unpublish`, { method: "POST" });
}

/**
 * Fetch a public game by slug. Returns null on 404 so callers can render
 * a "not found" state cleanly instead of catching exceptions. Other non-2xx
 * statuses throw an ApiError.
 */
export async function fetchPublicGame(slug: string): Promise<PublicGame | null> {
  try {
    return await apiFetch<PublicGame>(`/api/play/${slug}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Fire-and-forget play counter. Failures are silently ignored. */
export function recordPlay(slug: string): void {
  apiFetch<void>(`/api/play/${slug}/play`, { method: "POST" }).catch(() => {
    /* silent */
  });
}

export interface LikeResponse {
  liked: boolean;
  changed: boolean;
  likeCount: number;
}

export async function likeGame(slug: string): Promise<LikeResponse> {
  try {
    return await apiFetch<LikeResponse>(`/api/play/${slug}/like`, { method: "POST" });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw new Error("Sign in to like");
    throw err;
  }
}

export async function unlikeGame(slug: string): Promise<LikeResponse> {
  try {
    return await apiFetch<LikeResponse>(`/api/play/${slug}/like`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw new Error("Sign in to like");
    throw err;
  }
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

  return apiFetch<DiscoverPage>(`/api/discover?${search.toString()}`);
}

export async function remixPublicGame(slug: string): Promise<RemixResponse> {
  try {
    return await apiFetch<RemixResponse>(`/api/play/${slug}/remix`, { method: "POST" });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status === 401) throw new Error("Sign in to remix");
    if (err.status === 402) {
      // 402 envelope: { code, message, details: { kind, resetAt } }. A
      // lifetime/free-trial exhaustion (vs a periodic credit reset) gets a
      // distinct message. `code` is the contract; kind/resetAt are the legacy
      // fallback so a stale server can't break this gracefully-degraded UX.
      const details = err.details ?? {};
      const kind = details.kind as string | undefined;
      const resetAt = typeof details.resetAt === "number" ? details.resetAt : undefined;
      if (err.code === "FREE_TIER_EXHAUSTED" || kind === "lifetime" || resetAt === 0) {
        throw new Error("You've used your free trial. Upgrade for more remixes.");
      }
      throw new Error("Out of credits — upgrade for more remixes.");
    }
    throw err;
  }
}
