import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

// Anchor the default DB path on this file's location, not the process cwd.
// drizzle-kit runs via `bun run --filter @arcadeai/db ...` with cwd
// `packages/db/`, so a relative "./apps/server/data/..." would resolve to the
// nonexistent `packages/db/apps/server/data/...` and db:studio would open a
// stray DB. This matches how the server resolves the same file
// (apps/server/src/lib/db.ts).
const defaultDbPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../apps/server/data/arcadeai.db"
);

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? defaultDbPath,
  },
});
