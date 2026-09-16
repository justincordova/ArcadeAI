import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type DrizzleClient = ReturnType<typeof createClient>;

/** Open one PostgreSQL connection pool for application data. */
export function createClient(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10 });
  return { db: drizzle(sql, { schema }), sql };
}
