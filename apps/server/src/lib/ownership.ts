import { games } from "@arcadeai/db";
import { eq } from "drizzle-orm";
import { db } from "./db.js";

export async function loadOwnedGame(gameId: string, userId: string) {
  const rows = await db.select().from(games).where(eq(games.id, gameId));
  const game = rows[0];
  if (!game || game.userId !== userId) {
    return null;
  }
  return game;
}
