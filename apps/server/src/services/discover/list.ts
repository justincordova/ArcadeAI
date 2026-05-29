// Discover-page listing service. Three sort modes share one query path,
// differentiated by the ORDER BY:
//
//   trending: time-decay score on like_count → newer likes weigh more
//   top:      raw like_count desc → all-time popularity
//   new:      published_at desc → freshest publishes
//
// Pagination is offset-based for simplicity. The dataset is small enough
// that "page 50" never materializes; if it ever does, switch to a
// keyset cursor on (score, id).

import { games, users } from "@arcadeai/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, sqlite } from "../../lib/db.js";

export type DiscoverSort = "trending" | "top" | "new";

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

interface ListInput {
  sort: DiscoverSort;
  genre?: string | null;
  limit: number;
  offset: number;
  /** When set, joins game_likes to flag which games the caller has liked. */
  viewerUserId?: string | null;
}

export async function listDiscoverGames({
  sort,
  genre,
  limit,
  offset,
  viewerUserId,
}: ListInput): Promise<DiscoverGame[]> {
  // Trending score: like_count / (hours_since_publish + 2)^1.3
  // The +2 keeps a brand-new game from spiking to infinity at hour 0,
  // and the 1.3 exponent decays popularity within ~2 days.
  const trendingScore = sql<number>`
    CAST(${games.likeCount} AS REAL) /
    POW((CAST(strftime('%s','now') AS REAL) * 1000 - COALESCE(${games.publishedAt}, ${games.createdAt})) / 3600000.0 + 2, 1.3)
  `;

  const orderBy =
    sort === "trending"
      ? [desc(trendingScore), desc(games.publishedAt)]
      : sort === "top"
        ? [desc(games.likeCount), desc(games.publishedAt)]
        : [desc(games.publishedAt)];

  // `publicSlug IS NOT NULL` belongs in the SQL WHERE — not a post-fetch
  // filter — so the row count the DB returns matches the items we emit.
  // Filtering null slugs after LIMIT would let a null-slug row shrink the
  // page below `limit`, which the route reads as "end of results" and stops
  // paginating, permanently hiding later games. Public-with-null-slug rows
  // are reachable (e.g. remix copies set publicSlug: null).
  const filters = [eq(games.isPublic, true), isNotNull(games.publicSlug)];
  if (genre) {
    // Cast to satisfy the typed-enum column; the API layer validates the
    // string against the allowed genre set before we get here.
    filters.push(eq(games.genre, genre as never));
  }

  const rows = await db
    .select({
      id: games.id,
      slug: games.publicSlug,
      title: games.title,
      thumbnail: games.thumbnail,
      originalPrompt: games.originalPrompt,
      ownerDisplayName: users.displayName,
      genre: games.genre,
      publishedAt: games.publishedAt,
      playCount: games.playCount,
      likeCount: games.likeCount,
    })
    .from(games)
    .innerJoin(users, eq(users.id, games.userId))
    .where(and(...filters))
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);

  if (!viewerUserId || rows.length === 0) {
    return rows
      .filter((r): r is typeof r & { slug: string } => r.slug !== null)
      .map((r) => ({
        ...r,
        ownerDisplayName: r.ownerDisplayName || "Anonymous",
        liked: false,
      }));
  }

  // Hydrate `liked` for the viewer in a single query. Small N (<= limit),
  // so a server-side join would be fine too, but a follow-up query keeps
  // the main query plan stable across sort modes. We drop to the bun:sqlite
  // handle here because Drizzle's IN (?, ?, ...) over a dynamic array is
  // verbose; a hand-rolled placeholder list is clearer.
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const stmt = sqlite.prepare(
    `SELECT game_id FROM game_likes WHERE user_id = ? AND game_id IN (${placeholders})`
  );
  const likedRows = stmt.all(viewerUserId, ...ids) as Array<{ game_id: string }>;
  const likedSet = new Set<string>(likedRows.map((r) => r.game_id));

  return rows
    .filter((r): r is typeof r & { slug: string } => r.slug !== null)
    .map((r) => ({
      ...r,
      ownerDisplayName: r.ownerDisplayName || "Anonymous",
      liked: likedSet.has(r.id),
    }));
}
