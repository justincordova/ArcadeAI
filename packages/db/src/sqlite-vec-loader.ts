import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { platform } from "node:process";
import * as sqliteVec from "sqlite-vec";

/**
 * macOS ships Bun against Apple's SQLite build, which has loadable extensions
 * disabled. To use sqlite-vec we point bun:sqlite at a Homebrew-installed
 * libsqlite3 that supports `loadExtension`. On Linux/Windows the bundled
 * SQLite supports extensions, so this is a no-op.
 *
 * MUST be called BEFORE any `new Database(...)` constructor — Bun caches the
 * SQLite library handle on the first Database instantiation.
 *
 * Idempotent: subsequent calls are no-ops.
 */
let customSqliteSelected = false;

export function selectCustomSqliteIfNeeded(): void {
  if (customSqliteSelected) return;
  customSqliteSelected = true;

  if (platform !== "darwin") return;

  const candidates = [
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple silicon
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib", // Intel
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `sqlite-vec requires a SQLite build with extension loading enabled. On macOS, install via Homebrew: \`brew install sqlite\`. Searched: ${candidates.join(", ")}`
    );
  }
  Database.setCustomSQLite(found);
}

/**
 * Load sqlite-vec into a Database connection and verify it's usable.
 * Throws if the extension cannot be loaded or `vec_version()` fails.
 *
 * Returns the loaded extension version string for logging.
 *
 * The caller is responsible for invoking `selectCustomSqliteIfNeeded()`
 * before constructing the Database on macOS.
 */
export function loadSqliteVec(db: Database): string {
  sqliteVec.load(db);
  const row = db.prepare("SELECT vec_version() AS v").get() as { v: string } | null;
  if (!row?.v) {
    throw new Error("sqlite-vec loaded but vec_version() returned no value");
  }
  return row.v;
}
