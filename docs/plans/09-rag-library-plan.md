# 09 — RAG library — Plan

Companion to `docs/designs/09-rag-library.md`.

This step is split into two coordinated workstreams. They share only
the seeded `rag_examples` + `rag_embeddings` tables; their code paths
are otherwise independent. **Workstream A** (build-time library
creation) can land first or in parallel; **Workstream B** (runtime
integration) is verifiable end-to-end only after A has seeded the
database.

## Pre-flight

- [ ] **Step 4 generation working with hardcoded prompt.** Confirm
      `POST /api/games` end-to-end: a real prompt streams Sonnet 4.6
      output into a playable iframe, the `games` row holds non-empty
      `current_code` after stream completion, and `messages` has one
      `kind='prompt'` row. This is the integration target Workstream
      B replaces.
- [ ] **Step 1 post-migrate `vec0` table.** Inspect
      `packages/db/src/post-migrate.ts` and confirm it issues the
      SPEC §5 CREATE statement verbatim:
      `CREATE VIRTUAL TABLE IF NOT EXISTS rag_embeddings USING vec0(id text primary key, genre text, embedding float[1536])`.
      Per SPEC §19 step 1 the post-migrate script is owned by step 1;
      step 9 only verifies/updates the existing script in place — do
      NOT duplicate the CREATE elsewhere. If step 1 landed before
      SPEC §5 was clarified to include `genre`, update the existing
      post-migrate string to add the `genre` column (it's a string
      change, not a Drizzle migration). Run the migration +
      post-migrate sequence on a fresh db file and verify the table
      appears in `sqlite_master` with all three columns.
- [ ] **Drizzle `rag_examples` table.** Confirm the schema in
      `packages/db/src/schema.ts` matches SPEC §5 exactly:
      `id text primary key, genre text not null, prompt text not null,
      html text not null, created_at integer not null`. Migrations
      are up to date.
- [ ] **Env vars present.** `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`
      are set in `.env` and listed in `.env.example` (SPEC §15).
      Build-time scripts read both.
- [ ] **Model id constants.** `packages/shared/src/models.ts`
      exports the Sonnet id (from step 4). Add the Opus 4.7 and
      embedding model ids if they are not already listed (SPEC §3).
- [ ] **`genre` column on `rag_embeddings` is resolved in SPEC.**
      SPEC §5 declares `rag_embeddings` as
      `vec0(id text primary key, genre text, embedding float[1536])`
      and SPEC §8's example retrieval query reads from it directly.
      No design decision to make here — verify the post-migrate
      CREATE matches SPEC §5 verbatim (previous task) and proceed.

## Ordered tasks

### Workstream A — Library creation (build-time)

1. **Add Opus 4.7 + embedding model id constants.**
   `packages/shared/src/models.ts` — export `OPUS = 'claude-opus-4-7'`
   and `EMBEDDING = 'text-embedding-3-small'`. Both are imported only
   by build-time scripts; nothing in `apps/server/src/services/`
   imports `OPUS`. Per SPEC §3 model ids live in this single file.

2. **Curated prompt list.**
   `apps/server/scripts/rag-prompts.ts` — export an array of
   `{ id, genre, prompt }` entries. Roughly 20 entries, ~2–3 per
   genre bucket from SPEC §6 (`paddle, snake, flappy, shooter,
   platformer, puzzle, runner, other`). Hand-written. This file is
   the editorial source of truth and is committed.

3. **Reference draft system prompt.**
   `apps/server/scripts/rag-draft-prompt.ts` — export
   `REFERENCE_DRAFT_SYSTEM_PROMPT`. This is the prompt given to
   Opus during drafting. Restates the SPEC §13 base contract verbatim
   so drafts already mostly conform: single complete HTML file, no
   markdown fences, `<canvas>` + `init`/`update`/`render`/`gameLoop`,
   title screen + game over, key state map, procedural assets,
   self-contained, try/catch + `parent.postMessage` errors. Mention
   that the output will be hand-edited and used as a few-shot
   reference for other models — the draft should optimize for
   structural clarity over cleverness.

4. **`scripts/draft-rag-examples.ts`.** Bun script.
   - Imports `OPUS` from `@arcadeai/shared`.
   - `import Anthropic from '@ai-sdk/anthropic'` (or the existing
     server-side wrapper, but read directly from env to keep this
     script self-contained).
   - Reads `apps/server/scripts/rag-prompts.ts`.
   - For each entry, calls `streamText` (or `generateText` —
     streaming is unnecessary for a build-time script) with model
     `OPUS`, system `REFERENCE_DRAFT_SYSTEM_PROMPT`, prompt
     `entry.prompt`. Writes the raw HTML to
     `apps/server/scripts/rag-drafts/<id>.html`.
   - Sequential, not parallel — Anthropic rate limits at low
     concurrency are fine for 20 calls.
   - Logs per-entry: id, genre, byte size, elapsed ms.
   - **Build-time only.** Never imported by runtime code.

5. **Gitignore the drafts dir.** Add
   `apps/server/scripts/rag-drafts/` to the repo `.gitignore`
   (alongside the existing entries from SPEC §4). Drafts are raw
   model output, not authoritative; only the curated copies are
   committed.

6. **Editorial review checklist.** This is a manual step performed
   by the developer between draft and embed/seed. Documented in
   the script header comment of `seed-rag-examples.ts` so future
   re-curation follows the same procedure:

   - [ ] Copy `rag-drafts/<id>.html` to
         `apps/server/scripts/rag-curated/<id>.html`.
   - [ ] Open the file in a browser. Confirm: title screen
         appears, key press starts the game, gameplay runs
         without errors in the console, game over state is
         reachable, restart works.
   - [ ] Inspect the source. Confirm: single HTML file, no
         markdown fences, no external `<script src>` / `<link>`
         / fonts (SPEC §13), `<canvas>` element present,
         `init` / `update(dt)` / `render` / `gameLoop` functions
         present, `requestAnimationFrame` driving the loop,
         input via keydown/keyup state map (not direct event
         handlers), procedural assets only (no data URLs of
         pre-baked images), try/catch + `parent.postMessage`
         error wrapper.
   - [ ] Trim / fix anything Opus got wrong. Common fixes:
         dt-driven physics that's actually frame-driven; missing
         restart-on-keypress; visible score; legible colors in
         dark mode.
   - [ ] Save. The curated copy is the artifact that will be
         embedded and seeded.

7. **Curated dir is committed.** `apps/server/scripts/rag-curated/`
   is NOT gitignored. The curated HTML files are the highest-leverage
   asset in the system (SPEC §8) and live in source control.

8. **`scripts/embed-rag-examples.ts`.** Bun script.
   - Imports `EMBEDDING` from `@arcadeai/shared`.
   - `import { openai } from '@ai-sdk/openai'`; uses the AI SDK
     `embed` (or `embedMany`) helper.
   - Reads `apps/server/scripts/rag-prompts.ts` and
     `apps/server/scripts/rag-curated/<id>.html` (verifying each
     curated file exists; aborts on missing).
   - For each entry, embeds `entry.prompt` (NOT the HTML —
     SPEC §8's retrieval embeds the user's runtime prompt against
     an embedding of the reference's prompt).
   - Writes `apps/server/scripts/rag-embeddings/<id>.json`
     containing `{ id, embedding: number[] }` (1536 floats).
   - Logs per-entry: id, vector norm sanity check (non-zero,
     finite).

9. **Gitignore the embeddings dir.**
   `apps/server/scripts/rag-embeddings/` added to `.gitignore`.
   Cheap to regenerate; not the authoritative artifact.

10. **`scripts/seed-rag-examples.ts`.** Bun script.
    - Imports the shared db client from `@arcadeai/db` (this
      triggers the `db.loadExtension()` call from Workstream B
      task 11; if Workstream B has not landed yet, this script
      blocks on it — see "Coordination" below).
    - Reads `rag-prompts.ts`, `rag-curated/<id>.html`,
      `rag-embeddings/<id>.json`.
    - Verifies counts match across all three sources.
    - In a single transaction:
      - For each entry:
        ```
        INSERT OR REPLACE INTO rag_examples
          (id, genre, prompt, html, created_at)
          VALUES (?, ?, ?, ?, ?)
        INSERT OR REPLACE INTO rag_embeddings (id, genre, embedding)
          VALUES (?, ?, ?)
        ```
        `genre` on `rag_embeddings` is denormalized from
        `rag_examples.genre` per SPEC §5 / §8. The `embedding`
        parameter is bound as the binary format produced by the
        `sqlite-vec` package's helper (see Workstream B task 11).
    - Logs per-genre counts after seeding (sanity check that all
      8 buckets are represented).
    - Idempotent: re-running replaces rows by `id`. Does NOT
      delete rows that no longer appear in `rag-prompts.ts` — if
      the curated set shrinks, the developer manually removes
      stale ids (rare; surfaced by the per-genre count log).

### Workstream B — Runtime integration

11. **Load `sqlite-vec` at db client init.**
    `packages/db/src/client.ts` — `bun add sqlite-vec` (in
    `packages/db`). Immediately after the SQLite handle is
    constructed and before any query runs, call:
    ```ts
    import * as sqliteVec from 'sqlite-vec'
    sqliteVec.load(rawSqliteHandle)
    ```
    (The exact API depends on the `sqlite-vec` package version;
    verify against its README at install time. The package
    abstracts the per-platform `loadExtension` path.) Add a
    one-line startup log: `db: sqlite-vec loaded, version=<x>`.
    Run a `SELECT vec_version()` smoke check on startup and fail
    fast if the extension is not actually usable.

12. **Verify post-migrate vec0 table matches SPEC §5.**
    `packages/db/src/post-migrate.ts` — confirm the existing CREATE
    statement (owned by step 1 per SPEC §19) is exactly:
    `CREATE VIRTUAL TABLE IF NOT EXISTS rag_embeddings USING vec0(id text primary key, genre text, embedding float[1536])`.
    If the `genre` metadata column is missing (step 1 may have
    landed before SPEC §5 was clarified), update the existing
    post-migrate string in place — do NOT duplicate the CREATE in
    a step-9 file. Re-run migrations on a fresh db file to confirm
    `rag_embeddings` exposes all three columns.

13. **Retrieval service module.**
    `apps/server/src/services/rag/retrieve.ts` — export
    `retrieveExample({ embedding, genre }): Promise<string | null>`.
    - Input types: `{ embedding: number[] | null; genre: string }`.
      The parameter name `embedding` is the standardized name
      consumed by step 10's classifier wiring; do not rename.
    - If `embedding` is `null`, `retrieveExample` returns `null`
      (graceful degrade — embedding call may have failed in step 10).
    - Serializes `embedding` (`number[]`) to `Float32Array` internally
      via the `sqlite-vec` helper before binding to the query.
    - Branches on `genre`:
      - If `genre` is one of the 8 SPEC §6 buckets AND
        `genre !== 'other'`: run the genre-filtered query
        (inner `WHERE genre = ?` per SPEC §8).
      - Else: run the global query (no inner WHERE).
    - Both queries follow the SPEC §8 shape verbatim:
      `SELECT html FROM rag_examples WHERE id IN (SELECT id FROM rag_embeddings [WHERE genre = ?] ORDER BY vec_distance_cosine(embedding, ?) LIMIT 1)`.
    - Returns the `html` string from `rag_examples`, or `null`
      if the result set is empty.
    - Catches and logs (WARN) any extension-level errors from
      `vec_distance_cosine`; returns `null` on error so the
      pipeline degrades gracefully (matches SPEC §6's failure
      stance for classification).

14. **Embedding helper.**
    `apps/server/src/services/llm/embed.ts` — export
    `embedPrompt(prompt: string): Promise<number[]>`. Wraps the
    AI SDK's `embed` against `openai.embedding(EMBEDDING)`.
    Reads `OPENAI_API_KEY` from env. Used by the generation
    route (and reusable by step 10 if classification ends up
    needing embeddings, though it doesn't per SPEC §6).

15. **RAG-augmented prompt builder.**
    `apps/server/src/services/llm/prompts/generation.ts` —
    keep `GENERATION_SYSTEM_PROMPT` (the base contract) as a
    constant. Add `buildGenerationSystemPrompt({ ragExample }: { ragExample: string | null }): string`:
    - If `ragExample` is `null`, returns the base contract
      unchanged (preserves step 4 behavior — safe degrade).
    - If `ragExample` is non-null, appends a delimited section:
      ```
      <base contract>

      ---

      Reference example — build something in this style. Match
      its structural pattern (init/update/render/gameLoop, title
      screen, key state map, procedural assets, self-contained
      single file). Do NOT copy its game mechanics; produce the
      game described by the user prompt.

      <ragExample HTML verbatim>
      ```
      The exact wording can be tuned during the build pass; the
      shape is "delimiter, framing instruction, full HTML, end".
      Full code, not a skeleton (SPEC §8).

16. **Wire retrieval into the generation route.**
    `apps/server/src/routes/games.ts` — in `POST /api/games`,
    after row insertion and SSE `meta` write, before the
    `streamText` call:
    ```ts
    const embedding = await embedPrompt(prompt)
    const genre = 'other' // step 10 replaces this with classifier output
    const ragHtml = await retrieveExample({ embedding, genre })
    const system = buildGenerationSystemPrompt({ ragExample: ragHtml })
    ```
    Then call `streamText({ model: SONNET, system, prompt, abortSignal })`
    using the new `system`. Step 4's existing AbortController +
    activeStreams + db-update-on-completion logic is unchanged.

17. **Parallel fanout shape (forward-compatible).**
    The SPEC §7 pipeline runs embed + classify + title in
    parallel. Title generation is already deferred; classify
    lands in step 10. For now, only the embed call is async
    pre-LLM work, so a single `await` is fine. Structure the
    code as a `Promise.all([...])` with a single entry so step
    10 just adds the classify promise without restructuring:
    ```ts
    const [embedding /*, classification, title */] =
      await Promise.all([
        embedPrompt(prompt),
        // step 10: classifyGenre(prompt),
      ])
    ```

18. **Remove or downgrade the hardcoded prompt path.**
    The hardcoded `GENERATION_SYSTEM_PROMPT` constant remains
    (used as the base inside `buildGenerationSystemPrompt`).
    No callsite outside the prompt builder should import it
    directly after this step. The route imports
    `buildGenerationSystemPrompt` only.

## Coordination between workstreams

Workstream B task 11 (`sqlite-vec` load at client init) must land
before Workstream A task 10 (seed script) runs, because the seed
script uses the shared db client and writes to the `rag_embeddings`
vec0 table, which requires the extension to be loaded. Order of
landing:

1. B-11, B-12 (load extension, verify post-migrate). Server still
   starts; nothing exercises the extension yet.
2. A-1 through A-9 (constants, prompts, draft, editorial pass,
   embed). No db writes yet.
3. A-10 (seed). Database now populated.
4. B-13 through B-18 (retrieval service, embed helper, prompt
   builder, route wiring).

Tasks A-1 through A-9 can run in parallel with B-11 and B-12 since
they don't share files. The seed (A-10) is the synchronization
point.

## Verification steps

Run with `bun run dev` and real `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`.
Run scripts with `bun run apps/server/scripts/<script>.ts`.

### Workstream A verification

1. **Draft script.**
   - `bun run apps/server/scripts/draft-rag-examples.ts`
   - Observe: 20 calls to Opus 4.7 complete; per-call log lines
     show id, genre, byte size, elapsed.
   - Files appear in `apps/server/scripts/rag-drafts/`.
   - Spot-check: open one in a browser; it loads (may have
     bugs — that's what the editorial pass fixes).

2. **Editorial pass.**
   - For each draft, copy to `rag-curated/`, run the checklist
     (task 6), edit until it passes.
   - All 20 curated files exist and play correctly.

3. **Embed script.**
   - `bun run apps/server/scripts/embed-rag-examples.ts`
   - Observe: 20 embed calls; each writes a JSON file with a
     1536-element array.
   - Sanity check: every vector has finite, non-zero values.

4. **Seed script.**
   - `bun run apps/server/scripts/seed-rag-examples.ts`
   - Observe: per-genre counts log shows all 8 buckets covered.
   - SQLite check: `SELECT count(*) FROM rag_examples` = 20.
     `SELECT count(*) FROM rag_embeddings` = 20.
   - Idempotency: re-run the seed; counts unchanged; no errors.

### Workstream B verification

5. **Extension load.**
   - Restart `bun run dev`.
   - Server log shows `db: sqlite-vec loaded` and a version
     string.
   - SQLite check from a Bun REPL or a one-off script:
     `SELECT vec_version()` returns a string.

6. **Retrieval service — global fallback.**
   - One-off script or test harness:
     ```ts
      const embedding = await embedPrompt('a fast paced shooter with neon visuals')
      const html = await retrieveExample({ embedding, genre: 'other' })
     ```
   - `html` is a non-empty string.
   - Cross-check the chosen example by looking up its id manually.

7. **Retrieval service — genre-filtered.**
   - Same harness, with `genre: 'shooter'`.
   - `html` is non-empty and corresponds to one of the
     curated shooter examples (not a paddle, snake, etc.).

8. **Empty-table degrade.**
   - On a fresh db (or after `DELETE FROM rag_examples;
     DELETE FROM rag_embeddings;`):
     `retrieveExample` returns `null` without throwing.
   - Re-seed before continuing.

9. **End-to-end generation with RAG.**
   - Sign in via the web app.
   - `/game/new`, prompt: "a top-down shooter with falling
     enemies and a power-up that doubles fire rate".
   - Server logs show: embed call (~$0.0001), retrieval call
     (chosen example id), Sonnet stream.
   - The streamed game plays. Compare structural quality to a
     step-4 (no-RAG) generation if a baseline branch is handy
     — this is qualitative; the harder check is that the
     pipeline doesn't regress.

10. **No Opus at runtime.**
    - Search server logs across several generations:
      `grep claude-opus-4-7` returns nothing for runtime calls.
    - The Opus model id appears only in the build-time draft
      script. SPEC §3 / §8 contract upheld.

11. **Step-10 readiness.**
    - Manually edit `routes/games.ts` to pass `genre: 'flappy'`
      instead of `'other'`. Rerun a flappy-style prompt.
    - Server log shows the genre-filtered query path.
    - Revert the literal back to `'other'` before committing.

12. **Build & lint** (per `AGENTS.md` pre-commit gate).
    - `bun run build` (typecheck across workspaces).
    - `bun run check` (Biome).
    - Both pass.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — sqlite-vec extension wiring

After the database / `post-migrate` tasks complete (load `sqlite-vec`, ensure `rag_embeddings` virtual table is created) and the pre-commit gate passes:

```
chore(db): load sqlite-vec extension and update post-migrate
```

Includes: `sqlite-vec` extension loader, `packages/db` post-migrate updates, and the `rag_embeddings` virtual-table bootstrap.

### Checkpoint 2 — Workstream A (library seed)

After **Workstream A** tasks complete (curated reference snippets, embedding generation, seed script) and the pre-commit gate passes:

```
feat(rag): seed curated reference library with embeddings
```

Includes: `rag_examples` schema additions, the seed script, curated reference snippets, and the embedding-generation pipeline.

### Checkpoint 3 — Workstream B (runtime retrieval)

After **Workstream B** tasks complete (retrieval service, integration into the generation pipeline) and the pre-commit gate passes:

```
feat(rag): integrate retrieval into generation pipeline
```

Includes: retrieval service, prompt assembly updates, and the wiring that injects retrieved snippets into single-shot generation.

## Rollback notes

### Workstream A rollback

- Run on the live db file:
  `DELETE FROM rag_embeddings; DELETE FROM rag_examples;`
  This empties the curated set; `retrieveExample` then returns
  `null` and the generation route falls back to no-few-shot
  (step 4 behavior).
- The committed files in `apps/server/scripts/rag-curated/` and
  `apps/server/scripts/rag-prompts.ts` can stay in place — they
  are inert unless the seed script runs.
- `apps/server/scripts/rag-drafts/` and
  `apps/server/scripts/rag-embeddings/` are gitignored; deleting
  the dirs is harmless.
- The Opus 4.7 and embedding model id constants in
  `packages/shared/src/models.ts` are inert if no callsite
  imports them; safe to leave or remove.

### Workstream B rollback

- Revert the route change in `apps/server/src/routes/games.ts`:
  pass the original hardcoded `GENERATION_SYSTEM_PROMPT` directly
  to `streamText` (drop the embed + retrieve + buildPrompt steps).
  This restores step 4 behavior end-to-end.
- The retrieval service (`services/rag/retrieve.ts`), embed
  helper (`services/llm/embed.ts`), and the
  `buildGenerationSystemPrompt` function are additive — leaving
  them in place but unused is safe.
- The `db.loadExtension` call in `packages/db/src/client.ts`
  can stay even after rollback — it's idempotent and has no
  effect unless `vec0` queries run. Removing it is also safe
  if the extension itself is suspect; revert by deleting the
  three lines (load + smoke check + log) and uninstalling
  `sqlite-vec`.
- The post-migrate vec0 CREATE statement (from step 1) is left
  in place — empty `rag_embeddings` is harmless.
- No `usage_log`, `users`, or `games` schema impact in this
  step; nothing to undo there.
