/**
 * Build-time script: seed the curated reference library into the public
 * `games` table under a synthetic "ArcadeAI" creator so the games appear
 * on the Discover page.
 *
 * Run: DATABASE_URL=postgresql://... bun run apps/server/scripts/seed-system-games.ts
 *
 * Independent from seed-rag-examples.ts — this one does NOT touch
 * rag_examples or rag_embeddings. It only writes:
 *   - a single synthetic user row (id = SYSTEM_USER_ID), idempotent
 *   - one `games` row per RAG entry (id = `system-<rag-id>`), upserted
 *
 * Idempotent: re-running updates titles/code/thumbnails in place but never
 * duplicates rows. Existing engagement metrics (play_count, like_count) on
 * already-seeded rows are preserved.
 *
 * Reads:
 *   apps/server/scripts/rag-prompts.ts        (editorial source for prompts)
 *   apps/server/scripts/rag-curated/<id>.html (full HTML per entry)
 *
 * The script also generates a stable public_slug per game derived from the
 * RAG id, so the /play/:slug URL is permanent across re-seeds.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@arcadeai/db";
import { RAG_PROMPTS, type RagPrompt } from "./rag-prompts.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(SCRIPTS_DIR, "rag-curated");

// Stable identifiers for the synthetic creator. These must never change
// without also writing a migration to move existing rows.
const SYSTEM_USER_ID = "00000000-0000-4000-8000-000000000001";
const SYSTEM_USER_EMAIL = "system@arcadeai.local";
const SYSTEM_USER_DISPLAY_NAME = "ArcadeAI";

// Hand-curated display titles, keyed by RAG id. The RAG prompts are long
// descriptive sentences; these are short, presentable titles for tiles.
const TITLES: Record<string, string> = {
  "paddle-classic-pong": "Classic Pong",
  "paddle-breakout-neon": "Neon Breakout",
  "paddle-arkanoid-powerups": "Arkanoid: Power Drop",
  "snake-classic-grid": "Classic Snake",
  "snake-wraparound-portals": "Wraparound Snake",
  "flappy-bird-pipes": "Flappy Pipes",
  "flappy-rocket-asteroids": "Rocket Drift",
  "shooter-space-invaders": "Space Invaders",
  "shooter-asteroid-field": "Asteroid Field",
  "shooter-twin-stick-arena": "Twin-Stick Arena",
  "platformer-jump-and-run": "Jump and Run",
  "platformer-coyote-time-precision": "Coyote Time",
  "puzzle-match-three": "Match Three",
  "puzzle-sliding-tile": "Sliding Tiles",
  "puzzle-tetris-lines": "Line Stacker",
  "runner-endless-jumper": "Endless Runner",
  "runner-lane-switcher": "Lane Switcher",
  "other-tower-defense-mini": "Mini Tower Defense",
  "other-color-survival-dodger": "Color Dodger",
  "other-rhythm-tap": "Rhythm Tap",
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

/**
 * Derive a stable 8-char public slug from a RAG entry's id. Uses a hex
 * encoding of a deterministic hash so the resulting slug looks like the
 * randomUUID-based slugs that real publishes generate, but never changes
 * across re-seeds. Collision with a real user slug is astronomically
 * unlikely (8 hex ≈ 4.3B combinations). Note the INSERT below uses
 * OR IGNORE, which swallows a slug-unique conflict rather than raising it
 * — the per-row `changes` check in the seed loop is what actually surfaces
 * a collision.
 */
function slugFor(ragId: string): string {
  // FNV-1a 32-bit, doubled for 8 hex characters. Plenty for 20 entries.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < ragId.length; i++) {
    h1 ^= ragId.charCodeAt(i);
    h1 = (h1 * 0x01000193) >>> 0;
    h2 ^= ragId.charCodeAt(i);
    h2 = (h2 * 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(4, "0").slice(-4) + h2.toString(16).padStart(4, "0").slice(-4);
}

function gameIdFor(ragId: string): string {
  return `system-${ragId}`;
}

async function main() {
  // Verify every curated HTML exists and every entry has a display title.
  const missing: string[] = [];
  const untitled: string[] = [];
  for (const entry of RAG_PROMPTS) {
    if (!existsSync(join(CURATED_DIR, `${entry.id}.html`))) {
      missing.push(`${entry.id}.html`);
    }
    if (!TITLES[entry.id]) {
      untitled.push(entry.id);
    }
  }
  if (missing.length > 0) {
    console.error("Missing curated HTML files:");
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }
  if (untitled.length > 0) {
    console.error("Missing display titles in seed-system-games.ts:");
    for (const u of untitled) console.error(`  - ${u}`);
    process.exit(1);
  }

  const { sql } = createClient(databaseUrl as string);
  const now = Date.now();

  // Preload all HTML into memory so the seed runs in one transaction.
  const records: Array<{
    gameId: string;
    title: string;
    slug: string;
    entry: RagPrompt;
    html: string;
  }> = [];
  for (const entry of RAG_PROMPTS) {
    const html = await readFile(join(CURATED_DIR, `${entry.id}.html`), "utf8");
    records.push({
      gameId: gameIdFor(entry.id),
      title: TITLES[entry.id] as string,
      slug: slugFor(entry.id),
      entry,
      html,
    });
  }

  await sql.begin(async (tx) => {
    await tx`INSERT INTO "user" (id, email, email_verified, name, display_name, tier, credits_remaining_daily, credits_remaining_monthly, daily_reset_at, monthly_reset_at, lifetime_generations_used, lifetime_refinements_used, theme, created_at, updated_at) VALUES (${SYSTEM_USER_ID}::uuid, ${SYSTEM_USER_EMAIL}, true, ${SYSTEM_USER_DISPLAY_NAME}, ${SYSTEM_USER_DISPLAY_NAME}, 'admin', 0, 0, 0, 0, 0, 0, 'dark', ${now}, ${now}) ON CONFLICT (id) DO NOTHING`;
    for (const r of records) {
      await tx`INSERT INTO games (id, user_id, title, current_code, genre, original_prompt, is_public, public_slug, published_at, play_count, like_count, created_at, updated_at) VALUES (${r.gameId}, ${SYSTEM_USER_ID}::uuid, ${r.title}, ${r.html}, ${r.entry.genre}, ${r.entry.prompt}, true, ${r.slug}, ${now}, 0, 0, ${now}, ${now}) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, current_code = EXCLUDED.current_code, genre = EXCLUDED.genre, original_prompt = EXCLUDED.original_prompt, is_public = true, public_slug = EXCLUDED.public_slug, published_at = COALESCE(games.published_at, EXCLUDED.published_at), updated_at = EXCLUDED.updated_at`;
    }
  });

  // Sanity report.
  const [counts] = await sql<
    { total: number; published: number }[]
  >`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_public)::int AS published FROM games WHERE user_id = ${SYSTEM_USER_ID}::uuid`;
  const per = await sql<
    { genre: string; n: number }[]
  >`SELECT genre, count(*)::int AS n FROM games WHERE user_id = ${SYSTEM_USER_ID}::uuid GROUP BY genre ORDER BY genre`;

  console.log(
    `Seeded ${records.length} ArcadeAI games — total=${counts.total}, public=${counts.published}`
  );
  console.log("Per-genre counts:");
  for (const row of per) console.log(`  ${row.genre.padEnd(12)} ${row.n}`);
  console.log("\nView on Discover: http://localhost:5173/discover");

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
