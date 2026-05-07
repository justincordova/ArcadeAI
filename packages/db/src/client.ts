import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";
import { loadSqliteVec, selectCustomSqliteIfNeeded } from "./sqlite-vec-loader.js";

export type DrizzleClient = ReturnType<typeof createClient>;

export function createClient(path: string) {
  // Must run before `new Database(...)` on macOS so Bun links against a
  // SQLite build with loadable-extension support.
  selectCustomSqliteIfNeeded();

  const sqlite = new Database(path, { create: true });

  // Enable WAL mode for better concurrent read performance
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const version = loadSqliteVec(sqlite);
  console.log(`db: sqlite-vec loaded, version=${version}`);

  return drizzle(sqlite, { schema });
}
