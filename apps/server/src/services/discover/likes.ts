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
  // Synchronous callback so Drizzle's bun-sqlite driver wraps the insert and
  // the counter update in one real transaction. An `async` callback commits at
  // the first `await`, so a failure on the counter UPDATE after a successful
  // INSERT would leave game_likes and games.like_count drifted. `.all()`/
  // `.run()` execute each statement synchronously inside the transaction.
  return db.transaction((tx) => {
    // Verify the game is public; non-public games can't be liked. Returns
    // null to the caller so it can 404 (we don't expose private existence).
    const rows = tx
      .select({ id: games.id, likeCount: games.likeCount, isPublic: games.isPublic })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row || !row.isPublic) return null;

    // INSERT OR IGNORE → idempotent. Drive the "did anything change"
    // signal off the actual insert outcome rather than a pre-check SELECT.
    // Under bun:sqlite's BEGIN DEFERRED transactions, a concurrent like
    // from the same user could pass the pre-check, then collide with the
    // unique index on insert. `.onConflictDoNothing()` collapses that race
    // into the idempotent "already liked, no-op" branch instead of a 500.
    const inserted = tx
      .insert(gameLikes)
      .values({
        gameId,
        userId,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .returning({ gameId: gameLikes.gameId })
      .all();

    if (inserted.length === 0) {
      return { liked: true, changed: false, likeCount: row.likeCount };
    }

    // Return the authoritative post-update count via RETURNING rather than
    // arithmetic on the value read at the top of the transaction. Two
    // concurrent likers would otherwise both echo back the same stale count
    // (the DB lands correctly because the increment is relative, but the
    // returned value drove the heart counter and could be wrong until refetch).
    const [updated] = tx
      .update(games)
      .set({ likeCount: sql`${games.likeCount} + 1` })
      .where(eq(games.id, gameId))
      .returning({ likeCount: games.likeCount })
      .all();

    return { liked: true, changed: true, likeCount: updated?.likeCount ?? row.likeCount + 1 };
  });
}

export async function unlikeGame(gameId: string, userId: string): Promise<LikeResult | null> {
  // Synchronous callback — see likeGame for why an async transaction callback
  // would break atomicity between the delete and the counter update.
  return db.transaction((tx) => {
    const rows = tx
      .select({ id: games.id, likeCount: games.likeCount, isPublic: games.isPublic })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row || !row.isPublic) return null;

    const deleted = tx
      .delete(gameLikes)
      .where(and(eq(gameLikes.gameId, gameId), eq(gameLikes.userId, userId)))
      .returning({ gameId: gameLikes.gameId })
      .all();

    if (deleted.length === 0) {
      return { liked: false, changed: false, likeCount: row.likeCount };
    }

    // Clamp at 0 in case the counter ever drifts negative — should never
    // happen, but a malformed migration would otherwise wedge the column.
    const [updated] = tx
      .update(games)
      .set({ likeCount: sql`MAX(${games.likeCount} - 1, 0)` })
      .where(eq(games.id, gameId))
      .returning({ likeCount: games.likeCount })
      .all();

    return {
      liked: false,
      changed: true,
      likeCount: updated?.likeCount ?? Math.max(0, row.likeCount - 1),
    };
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
