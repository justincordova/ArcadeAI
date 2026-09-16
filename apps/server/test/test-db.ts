// PostgreSQL test helper. Each fixture gets a private schema in the local
// Supabase database, so Bun's parallel test files cannot leak state into each
// other or into the development schema.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "@arcadeai/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const migrationsFile = fileURLToPath(
  new URL("../../../packages/db/src/migrations/postgres/0000_baseline.sql", import.meta.url)
);

function positionalParameters(statement: string): string {
  let index = 0;
  return statement.replaceAll("?", () => `$${++index}`);
}

export type TestDb = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sql: Sql;
  client: {
    prepare: <T = Record<string, unknown>>(
      statement: string
    ) => {
      run: (...values: unknown[]) => Promise<void>;
      get: (...values: unknown[]) => Promise<T | null>;
    };
    query: <T = Record<string, unknown>, Args extends unknown[] = unknown[]>(
      statement: string
    ) => {
      run: (...values: Args) => Promise<void>;
      get: (...values: Args) => Promise<T | null>;
    };
  };
  authUserIds: Set<string>;
  close: () => Promise<void>;
};

export async function createTestDb(): Promise<TestDb> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const schemaName = `test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = postgres(databaseUrl, { max: 1 });

  try {
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
    const baseline = readFileSync(migrationsFile, "utf8").replace(
      /^CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;\n\n/,
      ""
    );
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public`);
      await tx.unsafe(baseline);
    });
  } catch (error) {
    await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    throw error;
  } finally {
    await admin.end();
  }

  // `search_path` is a PostgreSQL startup parameter. A single connection keeps
  // every raw query, Drizzle operation, and transaction in this test schema.
  const sql = postgres(databaseUrl, {
    max: 1,
    connection: { search_path: `${schemaName}, public` },
  });
  const authUserIds = new Set<string>();
  const client = {
    prepare: <T = Record<string, unknown>>(statement: string) => ({
      run: async (...values: unknown[]) => {
        await sql.unsafe(positionalParameters(statement), values as unknown as never[]);
      },
      get: async (...values: unknown[]) => {
        const rows = await sql.unsafe<T[]>(
          positionalParameters(statement),
          values as unknown as never[]
        );
        return rows[0] ?? null;
      },
    }),
    query: <T = Record<string, unknown>, Args extends unknown[] = unknown[]>(
      statement: string
    ) => ({
      run: async (...values: Args) => {
        await sql.unsafe(positionalParameters(statement), values as unknown as never[]);
      },
      get: async (...values: Args) => {
        const rows = await sql.unsafe<T[]>(
          positionalParameters(statement),
          values as unknown as never[]
        );
        return rows[0] ?? null;
      },
    }),
  };

  return {
    db: drizzle(sql, { schema }),
    sql,
    client,
    authUserIds,
    close: async () => {
      await sql.end();
      const cleanup = postgres(databaseUrl, { max: 1 });
      try {
        await cleanup.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        for (const id of authUserIds) {
          await cleanup`DELETE FROM auth.users WHERE id = ${id}::uuid`;
        }
      } finally {
        await cleanup.end();
      }
    },
  };
}

/**
 * Create the Supabase Auth identity as well as ArcadeAI's profile. Keeping
 * both rows is required when the profile's auth.users foreign key is enabled.
 */
export async function insertTestUser(
  testDb: TestDb,
  fields: {
    id?: string;
    email?: string;
    tier?: "free" | "creator" | "pro" | "admin";
    creditsRemainingDaily?: number;
    creditsRemainingMonthly?: number;
    dailyResetAt?: number;
    monthlyResetAt?: number;
    lifetimeGenerationsUsed?: number;
    lifetimeRefinementsUsed?: number;
  } = {}
): Promise<{ id: string }> {
  const id = fields.id ?? crypto.randomUUID();
  const email = fields.email ?? `${id}@test.local`;
  const now = Date.now();
  const farFuture = now + 365 * 24 * 60 * 60 * 1000;

  // This is the minimal row accepted by Supabase Auth's local auth.users
  // schema. It is intentionally inserted outside the per-test app schema.
  const auth = postgres(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, { max: 1 });
  try {
    await auth`
      INSERT INTO auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data
      ) VALUES (
        ${id}::uuid, 'authenticated', 'authenticated', ${email}, '', now(), '{}', '{}'
      )
      ON CONFLICT (id) DO NOTHING
    `;
  } finally {
    await auth.end();
  }

  testDb.authUserIds.add(id);

  await testDb.sql`
    INSERT INTO "user" (
      id, email, email_verified, name, display_name, tier,
      credits_remaining_daily, credits_remaining_monthly,
      daily_reset_at, monthly_reset_at,
      lifetime_generations_used, lifetime_refinements_used,
      theme, created_at, updated_at
    ) VALUES (
      ${id}::uuid, ${email}, false, '', ${`display-${id}`}, ${fields.tier ?? "free"},
      ${fields.creditsRemainingDaily ?? 500}, ${fields.creditsRemainingMonthly ?? 3000},
      ${fields.dailyResetAt ?? farFuture}, ${fields.monthlyResetAt ?? farFuture},
      ${fields.lifetimeGenerationsUsed ?? 0}, ${fields.lifetimeRefinementsUsed ?? 0},
      'dark', ${now}, ${now}
    )
  `;

  return { id };
}
