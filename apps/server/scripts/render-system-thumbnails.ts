/**
 * Build-time script: render thumbnails for every ArcadeAI system game by
 * loading its HTML in headless Chromium, waiting for the title screen to
 * draw, and capturing the canvas as a PNG data URL.
 *
 * Run: DATABASE_PATH=apps/server/data/arcadeai.db bun run \
 *        apps/server/scripts/render-system-thumbnails.ts
 *
 * Independent from seed-system-games.ts so it can be re-run without
 * re-seeding rows. Idempotent — re-running overwrites the thumbnail
 * column with a fresh capture.
 *
 * Only operates on the SYSTEM_USER_ID rows. User-generated thumbnails
 * are captured client-side from the Builder iframe; this script does not
 * touch those.
 *
 * Dimensions: 1280x800 (16:10) — fits both the Discover (16:10) and
 * Dashboard (16:9) tile aspect ratios with minimal cropping.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@arcadeai/db";
import { chromium } from "playwright";
import { RAG_PROMPTS } from "./rag-prompts.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(SCRIPTS_DIR, "rag-curated");

const SYSTEM_USER_ID = "system-arcadeai";

// Match the chunk of seed-system-games.ts — duplicated rather than
// imported because pulling that file in would also import the DB client
// and re-run its side effects.
function gameIdFor(ragId: string): string {
  return `system-${ragId}`;
}

const VIEWPORT = { width: 1280, height: 800 };
// How long to wait after the iframe loads for the game's init() + first
// render() to draw the title screen. Empirically ~500ms is enough for
// the reference games; 800ms adds a margin without slowing the seed
// noticeably (20 * 0.3s = 6s extra at worst).
const RENDER_WAIT_MS = 800;

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
  console.error("DATABASE_PATH environment variable is required");
  process.exit(1);
}

async function main() {
  // Verify every curated HTML exists.
  const missing: string[] = [];
  for (const entry of RAG_PROMPTS) {
    if (!existsSync(join(CURATED_DIR, `${entry.id}.html`))) {
      missing.push(`${entry.id}.html`);
    }
  }
  if (missing.length > 0) {
    console.error("Missing curated HTML files:");
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  const { sqlite } = createClient(dbPath as string);

  // Confirm the system rows exist before we spin up a browser.
  const existingCount = sqlite
    .prepare("SELECT count(*) AS n FROM games WHERE user_id = ?")
    .get(SYSTEM_USER_ID) as { n: number };
  if (existingCount.n === 0) {
    console.error("No system-arcadeai games found. Run seed-system-games.ts first to create rows.");
    process.exit(1);
  }

  console.log(
    `Rendering ${RAG_PROMPTS.length} thumbnails at ${VIEWPORT.width}x${VIEWPORT.height}…`
  );
  const browser = await chromium.launch({ headless: true });

  const updateThumbnail = sqlite.prepare(
    "UPDATE games SET thumbnail = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  );

  const startedAt = Date.now();
  let success = 0;
  let failed = 0;

  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    for (const entry of RAG_PROMPTS) {
      const gameId = gameIdFor(entry.id);
      const htmlPath = join(CURATED_DIR, `${entry.id}.html`);
      const html = await readFile(htmlPath, "utf8");

      try {
        // setContent waits for 'load' by default — i.e. the page's
        // inline scripts have parsed and run. We then wait a fixed
        // beat for the requestAnimationFrame-driven init/render to
        // populate the canvas with the title screen.
        await page.setContent(html, { waitUntil: "load" });
        await page.waitForSelector("canvas", { timeout: 5000 });
        await page.waitForTimeout(RENDER_WAIT_MS);

        const dataUrl = await page.evaluate(() => {
          const c = document.querySelector("canvas");
          if (!c) return null;
          try {
            return c.toDataURL("image/png");
          } catch {
            return null;
          }
        });

        if (!dataUrl?.startsWith("data:image/png;base64,")) {
          throw new Error("captured no canvas data");
        }

        // The /api/games/:id/thumbnail route caps thumbnails at 350_000
        // chars. Reference games at 1280x800 typically land around
        // 100_000-200_000 chars; abort if a particular game blows past
        // the cap (which would only fail at upload time on the user
        // path anyway).
        if (dataUrl.length > 350_000) {
          throw new Error(`thumbnail too large: ${dataUrl.length} chars (cap 350000)`);
        }

        // A 0-row UPDATE means the system game row is missing (e.g. a new
        // rag-prompts entry that hasn't been seeded yet). Previously this
        // was silently counted as a success and logged with a ✓.
        const written = updateThumbnail.run(dataUrl, Date.now(), gameId, SYSTEM_USER_ID).changes;
        if (written !== 1) {
          throw new Error(`game row ${gameId} not found — run seed-system-games first`);
        }
        success++;
        const kb = Math.round(dataUrl.length / 1024);
        console.log(`  ✓ ${entry.id.padEnd(40)} ${kb} KB`);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${entry.id.padEnd(40)} ${msg}`);
      }
    }

    await context.close();
  } finally {
    await browser.close();
    sqlite.close();
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `\nDone — ${success}/${RAG_PROMPTS.length} thumbnails rendered in ${elapsed}s (${failed} failed).`
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
