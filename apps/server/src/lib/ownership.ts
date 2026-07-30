// Owner-scoped game lookups. Every helper here pushes the `userId` filter
// into SQL so an unauthorized request can never read another user's row —
// the single choke point for game ownership checks across the routes.
import { games, users } from "@arcadeai/db";
import { and, eq } from "drizzle-orm";
import { db } from "./db.js";

export async function loadOwnedGame(gameId: string, userId: string) {
  // Push the ownership filter into SQL so an unauthorized lookup never
  // reads the row. Defense in depth: keeps "exists but not yours" and
  // "doesn't exist" indistinguishable at the DB layer, and avoids loading
  // another user's game body into memory before discarding it.
  const rows = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fetch just the thumbnail for a published game.
 *
 * The OG image route needs exactly one column. Going through `loadPublicGame`
 * pulled `currentCode` (tens of KB) and `originalPrompt` out of the DB, plus a
 * second query for the owner's display name, and discarded all of it — on the
 * heaviest unauthenticated path in the app. Same rationale as the thumbnail
 * exclusion on GET /api/games and the id-only lookup in the play-count route.
 *
 * Returns `undefined` when no published game matches, which the caller must
 * distinguish from a published game that simply has no thumbnail (`null`).
 */
export async function loadPublicThumbnail(slug: string): Promise<string | null | undefined> {
  const rows = await db
    .select({ thumbnail: games.thumbnail })
    .from(games)
    .where(and(eq(games.publicSlug, slug), eq(games.isPublic, true)))
    .limit(1);
  return rows[0]?.thumbnail;
}

/**
 * Lookup a game by its public slug. Returns null if no game with that slug
 * exists OR if the matched game has been unpublished. The ONLY non-owner
 * read path. Selects only fields safe to expose publicly (no userId, no
 * usage_log timestamps, etc.).
 *
 * Genre, like count, and play count are exposed because they're already
 * surfaced on the discover page; the public play page also wants them
 * for the like control.
 */
export async function loadPublicGame(slug: string): Promise<{
  id: string;
  title: string;
  currentCode: string;
  originalPrompt: string;
  ownerDisplayName: string;
  publishedAt: number | null;
  genre: string | null;
  likeCount: number;
  playCount: number;
} | null> {
  // `thumbnail` is deliberately NOT selected. It is a base64 data URL up to
  // ~350 KB, GET /api/play/:slug spreads this whole object into its response,
  // and no consumer reads it — the play page loads the image by reference from
  // /api/og/:slug.png. Same reasoning as GET /api/games and listDiscoverGames.
  const rows = await db
    .select({
      id: games.id,
      title: games.title,
      currentCode: games.currentCode,
      originalPrompt: games.originalPrompt,
      isPublic: games.isPublic,
      publishedAt: games.publishedAt,
      userId: games.userId,
      genre: games.genre,
      likeCount: games.likeCount,
      playCount: games.playCount,
    })
    .from(games)
    .where(and(eq(games.publicSlug, slug), eq(games.isPublic, true)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Look up the owner's display name. We deliberately do NOT expose email
  // or any other identifier on the public payload.
  const ownerRows = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  const ownerDisplayName = ownerRows[0]?.displayName ?? "Anonymous";

  return {
    id: row.id,
    title: row.title,
    currentCode: row.currentCode,
    originalPrompt: row.originalPrompt,
    ownerDisplayName,
    publishedAt: row.publishedAt,
    genre: row.genre,
    likeCount: row.likeCount,
    playCount: row.playCount,
  };
}
