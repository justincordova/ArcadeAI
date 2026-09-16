import { createClient } from "@arcadeai/db";

export type DbClient = ReturnType<typeof createClient>;

/**
 * Factory for opening a DB at an arbitrary path. Tests can call this with
 * a dedicated connection URL to get an isolated handle. Production code uses
 * the shared `db` and `sql` clients below.
 */
export function createDb(databaseUrl: string): DbClient {
  return createClient(databaseUrl);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = createDb(databaseUrl);
export const db = client.db;
export const sql = client.sql;

// Augment FastifyInstance so its DB decorators type-check at every callsite.
declare module "fastify" {
  interface FastifyInstance {
    db: DbClient["db"];
    sql: DbClient["sql"];
  }
}
