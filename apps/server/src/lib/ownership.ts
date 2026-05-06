import { createClient, games } from "@arcadeai/db";
import { eq } from "drizzle-orm";

const dbPath = process.env.DATABASE_PATH ?? "./apps/server/data/arcadeai.db";
export const db = createClient(dbPath);

export async function loadOwnedGame(gameId: string, userId: string) {
  const rows = await db.select().from(games).where(eq(games.id, gameId));
  const game = rows[0];
  if (!game || game.userId !== userId) {
    return null;
  }
  return game;
}
