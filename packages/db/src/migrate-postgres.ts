import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run PostgreSQL migrations");
}

const migrationsFolder = fileURLToPath(new URL("./migrations/postgres", import.meta.url));
const migrationFiles = readdirSync(migrationsFolder)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const client = postgres(databaseUrl, { max: 1 });

try {
  await client`CREATE TABLE IF NOT EXISTS arcadeai_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  for (const file of migrationFiles) {
    const applied = await client<{ name: string }[]>`
      SELECT name FROM arcadeai_migrations WHERE name = ${file}
    `;
    if (applied.length > 0) continue;

    const contents = readFileSync(`${migrationsFolder}/${file}`, "utf8");
    await client.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO arcadeai_migrations (name) VALUES (${file})`;
    });
    console.log(`[migrate:postgres] applied ${file}`);
  }
} finally {
  await client.end();
}
