import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@arcadeai/db";

// Resolve the DB path relative to the server package, not the process cwd.
// `bun --filter '*' dev` runs each workspace from its own directory, so the
// server's cwd is `apps/server/`, but a developer running from the repo root
// would have a different cwd. Anchoring on this file's location avoids both.
const here = dirname(fileURLToPath(import.meta.url));
const defaultPath = resolve(here, "../../data/arcadeai.db");

export type DbClient = ReturnType<typeof createClient>;

/**
 * Factory for opening a DB at an arbitrary path. Tests can call this with
 * `:memory:` (or a tmp file) to get a fully isolated handle. Production code
 * uses the `db` / `sqlite` singletons below — Better Auth and several
 * services need the DB at module-load time, which makes a pure-DI rewrite
 * more invasive than it's worth right now.
 */
export function createDb(path: string): DbClient {
  return createClient(path);
}

const dbPath = process.env.DATABASE_PATH ?? defaultPath;

// Single shared bun:sqlite client for the whole server process.
// Imported by auth, ownership helpers, and route handlers.
const client = createDb(dbPath);
export const db = client.db;
export const sqlite = client.sqlite;

// Augment FastifyInstance so `app.db` / `app.sqlite` (decorated in index.ts)
// type-check at every callsite.
declare module "fastify" {
  interface FastifyInstance {
    db: DbClient["db"];
    sqlite: DbClient["sqlite"];
  }
}
