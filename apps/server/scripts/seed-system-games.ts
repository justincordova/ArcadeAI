/**
 * Build-time script: seed the curated reference library into the public
 * `games` table under a synthetic "ArcadeAI" creator so the games appear
 * on the Discover page.
 *
 * Run: DATABASE_PATH=apps/server/data/arcadeai.db bun run apps/server/scripts/seed-system-games.ts
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
const SYSTEM_USER_ID = "system-arcadeai";
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

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
  console.error("DATABASE_PATH environment variable is required");
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

  const { sqlite } = createClient(dbPath as string);
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

  // 1. Synthetic user row (idempotent via INSERT OR IGNORE).
  //    The "user" table is owned by Better Auth; we insert raw to skip
  //    Drizzle's strict checks around timestamps.
  const upsertUser = sqlite.prepare(`
    INSERT OR IGNORE INTO "user" (
      id, email, email_verified, name, image, display_name,
      tier, credits_remaining_daily, credits_remaining_monthly,
      daily_reset_at, monthly_reset_at,
      lifetime_generations_used, lifetime_refinements_used,
      theme, created_at, updated_at
    ) VALUES (
      ?, ?, 1, ?, NULL, ?,
      'admin', 0, 0,
      0, 0,
      0, 0,
      'dark', ?, ?
    )
  `);
  upsertUser.run(
    SYSTEM_USER_ID,
    SYSTEM_USER_EMAIL,
    SYSTEM_USER_DISPLAY_NAME,
    SYSTEM_USER_DISPLAY_NAME,
    now,
    now
  );

  // 2. Game rows. INSERT OR IGNORE first (to create with metrics = 0), then
  //    UPDATE non-metric fields. This preserves play_count / like_count if
  //    a game was already seeded and engaged with.
  const insertGame = sqlite.prepare(`
    INSERT OR IGNORE INTO games (
      id, user_id, title, current_code, thumbnail, genre, original_prompt,
      is_public, public_slug, published_at, remixed_from_game_id,
      play_count, like_count, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, NULL, ?, ?,
      1, ?, ?, NULL,
      0, 0, ?, ?
    )
  `);
  const updateGame = sqlite.prepare(`
    UPDATE games
       SET title = ?,
           current_code = ?,
           genre = ?,
           original_prompt = ?,
           is_public = 1,
           public_slug = ?,
           published_at = COALESCE(published_at, ?),
           updated_at = ?
     WHERE id = ?
  `);

  const tx = sqlite.transaction(() => {
    for (const r of records) {
      insertGame.run(
        r.gameId,
        SYSTEM_USER_ID,
        r.title,
        r.html,
        r.entry.genre,
        r.entry.prompt,
        r.slug,
        now,
        now,
        now
      );
      const updated = updateGame.run(
        r.title,
        r.html,
        r.entry.genre,
        r.entry.prompt,
        r.slug,
        now,
        now,
        r.gameId
      ).changes;
      // OR IGNORE above swallows ANY conflict, not just the id conflict it
      // exists for. If the derived slug collides with a real user's
      // public_slug, the insert is silently skipped and this UPDATE (keyed
      // on the never-created id) matches 0 rows — previously the script
      // then reported success while the game was never seeded. Fail loudly
      // instead so the collision is visible and fixable.
      if (updated !== 1) {
        throw new Error(
          `Seed row ${r.gameId} was not written (0 rows updated). Likely a public_slug collision on "${r.slug}" with an existing user game.`
        );
      }
    }
  });
  tx();

  // Sanity report.
  const counts = sqlite
    .prepare(
      `SELECT count(*) AS total,
              sum(CASE WHEN is_public THEN 1 ELSE 0 END) AS published
         FROM games WHERE user_id = ?`
    )
    .get(SYSTEM_USER_ID) as { total: number; published: number };

  const per = sqlite
    .prepare(
      "SELECT genre, count(*) AS n FROM games WHERE user_id = ? GROUP BY genre ORDER BY genre"
    )
    .all(SYSTEM_USER_ID) as Array<{ genre: string; n: number }>;

  console.log(
    `Seeded ${records.length} ArcadeAI games — total=${counts.total}, public=${counts.published}`
  );
  console.log("Per-genre counts:");
  for (const row of per) console.log(`  ${row.genre.padEnd(12)} ${row.n}`);
  console.log("\nView on Discover: http://localhost:5173/discover");

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
