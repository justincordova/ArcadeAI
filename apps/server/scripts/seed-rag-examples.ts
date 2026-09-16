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
 *   rag_embeddings   (id, genre, embedding)  — pgvector table
 *
 * Idempotent: rows are upserted by `id` inside a single transaction.
 * Both tables use PostgreSQL UPSERTs.
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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is required");
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

  const { sql } = createClient(databaseUrl as string);

  const now = Date.now();

  // Pre-load every artefact so the entire seed runs inside one transaction.
  const records: Array<{
    id: string;
    genre: string;
    prompt: string;
    html: string;
    embedding: string;
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
      embedding: `[${parsed.embedding.join(",")}]`,
    });
  }

  await sql.begin(async (tx) => {
    for (const r of records) {
      await tx`INSERT INTO rag_examples (id, genre, prompt, html, created_at) VALUES (${r.id}, ${r.genre}, ${r.prompt}, ${r.html}, ${now}) ON CONFLICT (id) DO UPDATE SET genre = EXCLUDED.genre, prompt = EXCLUDED.prompt, html = EXCLUDED.html, created_at = EXCLUDED.created_at`;
      await tx`INSERT INTO rag_embeddings (id, genre, embedding) VALUES (${r.id}, ${r.genre}, ${r.embedding}::extensions.vector) ON CONFLICT (id) DO UPDATE SET genre = EXCLUDED.genre, embedding = EXCLUDED.embedding`;
    }
  });

  const [exampleCount] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM rag_examples`;
  const [embeddingCount] = await sql<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM rag_embeddings`;
  const perGenre = await sql<
    { genre: string; n: number }[]
  >`SELECT genre, count(*)::int AS n FROM rag_examples GROUP BY genre ORDER BY genre`;

  console.log(
    `Seeded ${records.length} reference examples — rag_examples=${exampleCount.n}, rag_embeddings=${embeddingCount.n}`
  );
  console.log("Per-genre counts:");
  for (const row of perGenre) console.log(`  ${row.genre.padEnd(12)} ${row.n}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
