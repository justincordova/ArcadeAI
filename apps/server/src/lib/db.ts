import { createClient } from "@arcadeai/db";

const dbPath = process.env.DATABASE_PATH ?? "./apps/server/data/arcadeai.db";

// Single shared bun:sqlite client for the whole server process.
// Imported by auth, ownership helpers, and route handlers.
const client = createClient(dbPath);
export const db = client.db;
export const sqlite = client.sqlite;
