import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { runPostMigrate } from "./post-migrate.js";
import { selectCustomSqliteIfNeeded } from "./sqlite-vec-loader.js";

// Default to the canonical server DB, anchored on this file's location (cwd is
// packages/db/ when run via `bun run --filter @arcadeai/db migrate`). This
// matches apps/server/src/lib/db.ts and drizzle.config.ts so a fresh local
// `bun run db:migrate` migrates the same DB the server opens, without needing
// DATABASE_PATH set. Production sets DATABASE_PATH explicitly.
const dbPath =
  process.env.DATABASE_PATH ??
  fileURLToPath(new URL("../../../apps/server/data/arcadeai.db", import.meta.url));

// Ensure the data directory exists
mkdirSync(dirname(resolve(dbPath)), { recursive: true });

// Pin the SQLite build before any Database is constructed so post-migrate
// (which loads sqlite-vec) ends up on the same library.
selectCustomSqliteIfNeeded();

const sqlite = new Database(dbPath, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const db = drizzle(sqlite);

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

// Always close the DB handle even if the migration throws. Leaving it open
// after a failure strands the WAL/SHM files in a state where the next
// process opening the DB has to recover them, and on macOS/Linux it leaks
// an open file descriptor for the lifetime of the parent process.
try {
  console.log("[migrate] Running Drizzle migrations from:", migrationsFolder);
  migrate(db, { migrationsFolder });
  console.log("[migrate] Drizzle migrations complete.");
} finally {
  sqlite.close();
}

console.log("[migrate] Running post-migrate steps...");
runPostMigrate(dbPath);
console.log("[migrate] Done.");
