import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@arcadeai/db";

// Resolve the DB path relative to the server package, not the process cwd.
// `bun --filter '*' dev` runs each workspace from its own directory, so the
// server's cwd is `apps/server/`, but a developer running from the repo root
// would have a different cwd. Anchoring on this file's location avoids both.
const here = dirname(fileURLToPath(import.meta.url));
const defaultPath = resolve(here, "../../data/arcadeai.db");
const dbPath = process.env.DATABASE_PATH ?? defaultPath;

// Single shared bun:sqlite client for the whole server process.
// Imported by auth, ownership helpers, and route handlers.
const client = createClient(dbPath);
export const db = client.db;
export const sqlite = client.sqlite;
