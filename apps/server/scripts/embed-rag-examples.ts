/**
 * Build-time script: embed each curated reference prompt with
 * text-embedding-3-small and write the vector to disk as JSON.
 *
 * Run: bun run apps/server/scripts/embed-rag-examples.ts
 *
 * Reads:
 *   apps/server/scripts/rag-prompts.ts             (editorial source)
 *   apps/server/scripts/rag-curated/<id>.html     (verifies presence)
 *
 * Writes:
 *   apps/server/scripts/rag-embeddings/<id>.json   ({ id, embedding: number[1536] })
 *
 * Embeddings are gitignored — re-running this script regenerates them. The
 * authoritative artifacts are the curated HTML files, not the embeddings.
 */
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { EMBEDDING } from "@arcadeai/shared";
import { embed } from "ai";
import { RAG_PROMPTS } from "./rag-prompts.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(SCRIPTS_DIR, "rag-curated");
const EMBEDDINGS_DIR = join(SCRIPTS_DIR, "rag-embeddings");

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

function isFiniteVector(v: unknown): v is number[] {
  if (!Array.isArray(v)) return false;
  if (v.length !== 1536) return false;
  let nonZero = 0;
  for (const x of v) {
    if (typeof x !== "number" || !Number.isFinite(x)) return false;
    if (x !== 0) nonZero++;
  }
  return nonZero > 0;
}

function vectorNorm(v: number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

async function main() {
  mkdirSync(EMBEDDINGS_DIR, { recursive: true });

  // Verify every curated file exists before spending money on embeddings.
  const missing: string[] = [];
  for (const entry of RAG_PROMPTS) {
    const p = join(CURATED_DIR, `${entry.id}.html`);
    if (!existsSync(p)) missing.push(p);
  }
  if (missing.length > 0) {
    console.error("Missing curated HTML files:");
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.log(`Embedding ${RAG_PROMPTS.length} curated prompts...`);

  for (const entry of RAG_PROMPTS) {
    const { embedding } = await embed({
      model: openai.embedding(EMBEDDING),
      value: entry.prompt,
    });
    if (!isFiniteVector(embedding)) {
      throw new Error(`invalid embedding for ${entry.id}: not a finite 1536-d vector`);
    }
    const norm = vectorNorm(embedding);
    const out = join(EMBEDDINGS_DIR, `${entry.id}.json`);
    await writeFile(out, JSON.stringify({ id: entry.id, embedding }));
    console.log(`  ${entry.id}  norm=${norm.toFixed(4)}  dims=${embedding.length}`);
  }

  console.log(`Wrote ${RAG_PROMPTS.length} embeddings to ${EMBEDDINGS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
