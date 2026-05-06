import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

export type DrizzleClient = ReturnType<typeof createClient>;

export function createClient(path: string) {
  const sqlite = new Database(path, { create: true });

  // Enable WAL mode for better concurrent read performance
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  return drizzle(sqlite, { schema });
}
