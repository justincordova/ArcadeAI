// Test helper: creates a fresh in-memory SQLite DB with the full schema
// applied. Tests that import this module get a brand-new DB per call.
//
// We mirror the runtime path in `apps/server/src/lib/db.ts`: open a Database,
// enable WAL + foreign keys, wrap with Drizzle, run Drizzle migrations from
// the packages/db migrations folder. We deliberately skip the `sqlite-vec`
// extension load — none of the unit tests under `test/` exercise vector
// search, and skipping it avoids the macOS Homebrew SQLite dependency in CI.

import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

export type TestDb = {
  db: ReturnType<typeof drizzle>;
  sqlite: Database;
  close: () => void;
};

export function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const db = drizzle(sqlite);

  const migrationsFolder = fileURLToPath(
    new URL("../../../packages/db/src/migrations", import.meta.url)
  );
  migrate(db, { migrationsFolder });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}

/**
 * Insert a fresh user row with the given fields. Tests use this to set up
 * arbitrary user states (tier, credits, lifetime counters) without going
 * through Better Auth's user-creation flow.
 */
export function insertTestUser(
  sqlite: Database,
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
): { id: string } {
  const id = fields.id ?? `user-${crypto.randomUUID()}`;
  const email = fields.email ?? `${id}@test.local`;
  const now = Date.now();
  const farFuture = now + 365 * 24 * 60 * 60 * 1000;

  sqlite
    .prepare(
      `INSERT INTO "user" (
        id, email, email_verified, name, display_name, tier,
        credits_remaining_daily, credits_remaining_monthly,
        daily_reset_at, monthly_reset_at,
        lifetime_generations_used, lifetime_refinements_used,
        theme, created_at, updated_at
      ) VALUES (?, ?, 0, '', ?, ?, ?, ?, ?, ?, ?, ?, 'dark', ?, ?)`
    )
    .run(
      id,
      email,
      `display-${id}`,
      fields.tier ?? "free",
      fields.creditsRemainingDaily ?? 500,
      fields.creditsRemainingMonthly ?? 3000,
      fields.dailyResetAt ?? farFuture,
      fields.monthlyResetAt ?? farFuture,
      fields.lifetimeGenerationsUsed ?? 0,
      fields.lifetimeRefinementsUsed ?? 0,
      now,
      now
    );

  return { id };
}
