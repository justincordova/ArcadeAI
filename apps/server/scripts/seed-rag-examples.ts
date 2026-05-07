/**
 * Build-time script: seed the curated reference library into the database.
 *
 * Run: bun run apps/server/scripts/seed-rag-examples.ts
 *
 * Reads:
 *   apps/server/scripts/rag-prompts.ts             (editorial source)
 *   apps/server/scripts/rag-curated/<id>.html      (full HTML per entry)
 *   apps/server/scripts/rag-embeddings/<id>.json   (1536-d float vector)
 *
 * Writes:
 *   rag_examples     (id, genre, prompt, html, created_at)
 *   rag_embeddings   (id, genre, embedding)  — vec0 virtual table
 *
 * Idempotent: rows are upserted by `id` inside a single transaction.
 *   - `rag_examples` uses `INSERT OR REPLACE`.
 *   - `rag_embeddings` is a vec0 virtual table that does NOT support
 *     `OR REPLACE`, so each row is `DELETE`d then `INSERT`ed.
 * Re-running after a curated edit re-seeds in place. This script does NOT
 * delete rows whose ids no longer appear in `rag-prompts.ts`; remove those
 * manually.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@arcadeai/db";
import { RAG_PROMPTS } from "./rag-prompts.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(SCRIPTS_DIR, "rag-curated");
const EMBEDDINGS_DIR = join(SCRIPTS_DIR, "rag-embeddings");

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
  console.error("DATABASE_PATH environment variable is required");
  process.exit(1);
}

async function main() {
  // Verify all source artefacts are present before touching the database.
  const missing: string[] = [];
  for (const entry of RAG_PROMPTS) {
    const html = join(CURATED_DIR, `${entry.id}.html`);
    const emb = join(EMBEDDINGS_DIR, `${entry.id}.json`);
    if (!existsSync(html)) missing.push(html);
    if (!existsSync(emb)) missing.push(emb);
  }
  if (missing.length > 0) {
    console.error("Missing required source files:");
    for (const m of missing) console.error(`  - ${m}`);
    console.error("Run `bun run apps/server/scripts/embed-rag-examples.ts` first.");
    process.exit(1);
  }

  const { db, sqlite } = createClient(dbPath as string);

  // Confirm the vec0 virtual table exists; the post-migrate script (run
  // via `bun run --filter @arcadeai/db migrate`) is responsible for
  // creating it. Bail with a clear message if it isn't there yet.
  const vecTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE name = 'rag_embeddings'")
    .get();
  if (!vecTable) {
    console.error("rag_embeddings vec0 table is missing. Run db migrations first:");
    console.error("  bun run --filter @arcadeai/db migrate");
    process.exit(1);
  }

  const now = Date.now();

  // Pre-load every artefact so the entire seed runs inside one transaction.
  const records: Array<{
    id: string;
    genre: string;
    prompt: string;
    html: string;
    embedding: Float32Array;
  }> = [];
  for (const entry of RAG_PROMPTS) {
    const html = await readFile(join(CURATED_DIR, `${entry.id}.html`), "utf8");
    const raw = await readFile(join(EMBEDDINGS_DIR, `${entry.id}.json`), "utf8");
    const parsed = JSON.parse(raw) as { id: string; embedding: number[] };
    if (parsed.id !== entry.id) {
      throw new Error(`embedding file id ${parsed.id} does not match prompt id ${entry.id}`);
    }
    if (!Array.isArray(parsed.embedding) || parsed.embedding.length !== 1536) {
      throw new Error(`embedding for ${entry.id} is not a 1536-d array`);
    }
    records.push({
      id: entry.id,
      genre: entry.genre,
      prompt: entry.prompt,
      html,
      embedding: new Float32Array(parsed.embedding),
    });
  }

  const upsertExample = sqlite.prepare(
    "INSERT OR REPLACE INTO rag_examples (id, genre, prompt, html, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  // Vec0 tables don't support INSERT OR REPLACE; we delete then insert per row.
  const deleteEmbedding = sqlite.prepare("DELETE FROM rag_embeddings WHERE id = ?");
  const insertEmbedding = sqlite.prepare(
    "INSERT INTO rag_embeddings (id, genre, embedding) VALUES (?, ?, ?)"
  );

  const tx = sqlite.transaction(() => {
    for (const r of records) {
      upsertExample.run(r.id, r.genre, r.prompt, r.html, now);
      deleteEmbedding.run(r.id);
      insertEmbedding.run(r.id, r.genre, r.embedding);
    }
  });
  tx();

  // Sanity check the result.
  const exampleCount = sqlite.prepare("SELECT count(*) AS n FROM rag_examples").get() as {
    n: number;
  };
  const embeddingCount = sqlite.prepare("SELECT count(*) AS n FROM rag_embeddings").get() as {
    n: number;
  };

  const perGenre = sqlite
    .prepare("SELECT genre, count(*) AS n FROM rag_examples GROUP BY genre ORDER BY genre")
    .all() as Array<{ genre: string; n: number }>;

  console.log(
    `Seeded ${records.length} reference examples — rag_examples=${exampleCount.n}, rag_embeddings=${embeddingCount.n}`
  );
  console.log("Per-genre counts:");
  for (const row of perGenre) console.log(`  ${row.genre.padEnd(12)} ${row.n}`);

  // Suppress unused-binding warning from drizzle import — we're using
  // raw prepared statements rather than the typed schema for the bulk seed
  // (vec0 inserts go through `sqlite` directly).
  void db;

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
