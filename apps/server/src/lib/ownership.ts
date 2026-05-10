import { games, users } from "@arcadeai/db";
import { and, eq } from "drizzle-orm";
import { db } from "./db.js";

export async function loadOwnedGame(gameId: string, userId: string) {
  const rows = await db.select().from(games).where(eq(games.id, gameId));
  const game = rows[0];
  if (!game || game.userId !== userId) {
    return null;
  }
  return game;
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
  thumbnail: string | null;
} | null> {
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
      thumbnail: games.thumbnail,
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
    thumbnail: row.thumbnail,
  };
}
