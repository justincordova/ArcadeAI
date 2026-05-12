// Like / unlike a public game. Counter on games.like_count is denormalized
// for fast sort-by-likes; we keep it in sync with game_likes via a single
// transaction so a crash mid-write can't drift.
//
// likeGame is idempotent — if the row already exists, the INSERT OR IGNORE
// is a no-op and we return { liked: true, changed: false } without touching
// the counter. Same idempotency on unlike.

import { gameLikes, games } from "@arcadeai/db";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../lib/db.js";

export interface LikeResult {
  liked: boolean;
  /** True if this call actually toggled state (not an idempotent re-call). */
  changed: boolean;
  likeCount: number;
}

export async function likeGame(gameId: string, userId: string): Promise<LikeResult | null> {
  return db.transaction(async (tx) => {
    // Verify the game is public; non-public games can't be liked. Returns
    // null to the caller so it can 404 (we don't expose private existence).
    const rows = await tx
      .select({ id: games.id, likeCount: games.likeCount, isPublic: games.isPublic })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1);
    const row = rows[0];
    if (!row || !row.isPublic) return null;

    // INSERT OR IGNORE → idempotent. Drive the "did anything change"
    // signal off the actual insert outcome rather than a pre-check SELECT.
    // Under bun:sqlite's BEGIN DEFERRED transactions, a concurrent like
    // from the same user could pass the pre-check, then collide with the
    // unique index on insert. `.onConflictDoNothing()` collapses that race
    // into the idempotent "already liked, no-op" branch instead of a 500.
    const inserted = await tx
      .insert(gameLikes)
      .values({
        gameId,
        userId,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .returning({ gameId: gameLikes.gameId });

    if (inserted.length === 0) {
      return { liked: true, changed: false, likeCount: row.likeCount };
    }

    await tx
      .update(games)
      .set({ likeCount: sql`${games.likeCount} + 1` })
      .where(eq(games.id, gameId));

    return { liked: true, changed: true, likeCount: row.likeCount + 1 };
  });
}

export async function unlikeGame(gameId: string, userId: string): Promise<LikeResult | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: games.id, likeCount: games.likeCount, isPublic: games.isPublic })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1);
    const row = rows[0];
    if (!row || !row.isPublic) return null;

    const deleted = await tx
      .delete(gameLikes)
      .where(and(eq(gameLikes.gameId, gameId), eq(gameLikes.userId, userId)))
      .returning({ gameId: gameLikes.gameId });

    if (deleted.length === 0) {
      return { liked: false, changed: false, likeCount: row.likeCount };
    }

    // Clamp at 0 in case the counter ever drifts negative — should never
    // happen, but a malformed migration would otherwise wedge the column.
    await tx
      .update(games)
      .set({ likeCount: sql`MAX(${games.likeCount} - 1, 0)` })
      .where(eq(games.id, gameId));

    return { liked: false, changed: true, likeCount: Math.max(0, row.likeCount - 1) };
  });
}

/**
 * Increment play_count by 1. Best-effort, never throws — call sites are
 * fire-and-forget. Counts toward the discover-page sort.
 */
export async function recordPlay(gameId: string): Promise<void> {
  try {
    await db
      .update(games)
      .set({ playCount: sql`${games.playCount} + 1` })
      .where(and(eq(games.id, gameId), eq(games.isPublic, true)));
  } catch {
    // best-effort
  }
}
