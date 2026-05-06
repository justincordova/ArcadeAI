# 10 — Genre classification + style tags — Plan

Companion to `docs/designs/10-genre-classification.md`.

## Pre-flight

- [ ] Step 4 (single-shot generation) is complete: `POST /api/games`
      streams Sonnet output via SSE, the LLM client module exports a
      Sonnet streaming helper, `apps/server/src/services/llm/prompts/
      generation.ts` (or equivalent) holds the current monolithic
      generation system prompt, and `messages` rows persist on
      submit.
- [ ] Step 9 (RAG library integration) is complete: `sqlite-vec` is
      loaded, `rag_examples` and `rag_embeddings` are populated,
      `embedPrompt(prompt)` exists and returns a 1536-dim vector,
      and a retrieval helper exists (e.g. `retrieveExample`) that
      returns the few-shot HTML for injection. **Step 10 depends on
      step 9 because genre-filtered retrieval is the consumer of
      the classified genre.**
- [ ] `OPENAI_API_KEY` is set in `.env` and listed in `.env.example`
      (SPEC §15). `@ai-sdk/openai` is already installed (added in
      step 6 for code summarization).
- [ ] `MINI = 'gpt-4.1-mini'` is exported from
      `packages/shared/src/models.ts` (SPEC §3). Already present
      from step 6.
- [ ] Title generation is **landed by this step**, not earlier.
      SPEC §19 step 10's build-order note assigns the parallel
      GPT-4.1-mini title-generation call (SPEC §7) to step 10.
      Until this step ships, `games.title` is the placeholder slice
      written at row creation in step 4. Confirm step 4's
      `POST /api/games` handler currently writes only the
      placeholder (`prompt.slice(0, 40)`) and does not call any
      title-gen helper.
- [ ] Confirm `games.genre` column is present and nullable
      (declared in SPEC §5, created in step 3). No migration needed
      in this step.
- [ ] Sonnet system prompt construction is currently a single
      string (per step 4). Confirm the call site that hands it to
      `streamText` so it can be replaced with a builder call.

## Ordered tasks

### Shared

1. **Genre buckets constant.**
   `packages/shared/src/genres.ts` — export
   ```
   export const GENRE_BUCKETS = [
     'paddle','snake','flappy','shooter','platformer',
     'puzzle','runner','other',
   ] as const
   export type GenreBucket = (typeof GENRE_BUCKETS)[number]
   ```
   Order matches SPEC §6 verbatim. This is the single source of
   truth for the classifier schema, the prompt-variant registry,
   and the RAG retrieval filter.

### Server — classification service

2. **Classification module.**
   `apps/server/src/services/llm/classify.ts` — export
   `classifyPrompt(prompt: string): Promise<{ genre: GenreBucket;
   styleTags: string[] }>`. Implementation:
   - `import { generateObject } from 'ai'`
   - `import { openai } from '@ai-sdk/openai'`
   - `import { MINI } from '@arcadeai/shared/models'`
   - `import { GENRE_BUCKETS } from '@arcadeai/shared/genres'`
   - Zod schema:
     ```
     const Schema = z.object({
       genre: z.enum(GENRE_BUCKETS),
       style_tags: z.array(z.string()).max(5),
     })
     ```
   - Inline system prompt (terse, no separate file): "Classify the
     user's game prompt into one of these genres: paddle, snake,
     flappy, shooter, platformer, puzzle, runner, other. Use
     'other' if uncertain. Also extract up to 5 short aesthetic
     descriptors (e.g. retro, neon, minimal, cute, dark)."
   - Wrap the `generateObject` call in try/catch:
     ```
     try {
       const { object } = await generateObject({
         model: openai(MINI),
         mode: 'json',
         schema: Schema,
         system: SYSTEM,
         prompt,
       })
       const genre = (GENRE_BUCKETS as readonly string[]).includes(object.genre)
         ? object.genre
         : 'other'
       return { genre, styleTags: object.style_tags }
     } catch (err) {
       request.log.warn({ err }, 'genre classification failed; defaulting to other')
       return { genre: 'other', styleTags: [] }
     }
     ```
     Note: `request.log` is reached by passing the Fastify
     `request` (or just the logger) into `classifyPrompt`. Either
     accept a `logger` parameter or import a module-level Pino
     child — match the project's existing logger-passing
     convention from step 4's LLM client.
   - Function never throws. SPEC §6 contract.

### Server — title generation

3. **Title generation helper.**
   `apps/server/src/services/llm/title.ts` — export
   `generateTitle(prompt: string): Promise<string>`. Implementation:
   - `import { generateText } from 'ai'`
   - `import { openai } from '@ai-sdk/openai'`
   - `import { MINI } from '@arcadeai/shared/models'`
   - System prompt (inline, terse): "Generate a concise,
     descriptive game title for the user's prompt. Return only
     the title — no quotes, no punctuation, no preamble. Maximum
     80 characters."
   - Call `generateText({ model: openai(MINI), system, prompt })`,
     trim the result, slice to 80 chars, return.
   - **No internal try/catch.** The caller wraps in
     `Promise.allSettled`; a rejection means "keep placeholder."
   - Per SPEC §7 / §19 step 10, this is the title-gen call that
     runs in the parallel fanout alongside `classifyPrompt` and
     `embedPrompt`.

### Server — prompt variants

4. **Lift the §13 base contract.**
   `apps/server/src/services/llm/prompts/base.ts` — export
   `BASE_GENERATION_CONTRACT` containing the SPEC §13 base rules
   (single complete HTML, required `<canvas>` + `init` / `update` /
   `render` / `gameLoop` structure, key state map for input,
   procedural assets, wrapped game loop with `parent.postMessage`,
   self-contained — no `<script src>` / `<link>` / external
   fonts). Move this content out of step 4's monolithic
   `prompts/generation.ts`.

   **If step 9 added a few-shot wrapper** (e.g. a
   `formatExampleBlock` / few-shot injector function) to the same
   `prompts/generation.ts` file, lift it out as well — it belongs
   in `prompts/generation/index.ts` next to the builder (task 6),
   not in `base.ts`. Verify before this task: open
   `prompts/generation.ts` and identify everything currently
   exported. Anything that is not the §13 base contract goes into
   `generation/index.ts`.

   After this task, `prompts/generation.ts` should no longer
   exist — its contents are split between `prompts/base.ts` and
   `prompts/generation/index.ts`. Update any importers (the only
   consumer should be `routes/games.ts`, addressed in task 7).

5. **Genre-specific generation prompts.**
   Create `apps/server/src/services/llm/prompts/generation/` with
   one file per bucket:
   - `paddle.ts`, `snake.ts`, `flappy.ts`, `shooter.ts`,
     `platformer.ts`, `puzzle.ts`, `runner.ts`, `other.ts`.
   - Each exports a `string` extension to the base contract,
     keyed to genre-specific mechanics. Examples (lift from SPEC
     §13 where given):
     - `flappy.ts`: "single-button input, gravity simulation,
       infinite scrolling obstacles" (verbatim from SPEC §13).
     - `paddle.ts`: ball physics, paddle reflection angle,
       bricks or opponent paddle, score on hit.
     - `snake.ts`: grid-based movement, body grows on food,
       wrap or wall-collide, no reverse-direction in one step.
     - `shooter.ts`: player projectiles, enemy waves, collision
       detection, lives or score.
     - `platformer.ts`: gravity + jump, ground collision,
       moving platforms or hazards.
     - `puzzle.ts`: discrete grid or board state, win condition,
       move counter or timer optional.
     - `runner.ts`: auto-scroll, dodge/jump obstacles, distance
       score.
     - `other.ts`: empty string — no genre-specific extensions,
       base contract only.
   - Keep each variant terse (3–6 sentences). Sonnet only needs
     directional guidance; the RAG example carries structural
     specifics.

6. **Generation prompt builder.**
   `apps/server/src/services/llm/prompts/generation/index.ts` —
   exports:
   ```
   const VARIANTS: Record<GenreBucket, string> = {
     paddle, snake, flappy, shooter, platformer,
     puzzle, runner, other,
   }
   export function buildGenerationSystemPrompt(args: {
     genre: GenreBucket
     styleTags: string[]
     example: string | null
   }): string {
     const parts = [BASE_GENERATION_CONTRACT, VARIANTS[args.genre]]
     if (args.example) parts.push(formatExampleBlock(args.example))
     if (args.styleTags.length > 0) {
       parts.push(`Style guidance: ${args.styleTags.join(', ')}`)
     }
     return parts.filter(Boolean).join('\n\n')
   }
   ```
   `formatExampleBlock` is the existing step-9 few-shot wrapper
   ("Here is a reference example: …") — reuse, don't duplicate.

### Server — pipeline integration

7. **Update `POST /api/games` handler.**
   `apps/server/src/routes/games.ts`:
   - After `meta` SSE write and before Sonnet streaming, replace
     the existing serial / partial-parallel calls with a single
     `Promise.allSettled` over the three branches:
     ```
      const [classRes, embedRes, titleRes] = await Promise.allSettled([
        classifyPrompt(prompt, request.log),
        embedPrompt(prompt),         // step 9
        generateTitle(prompt),       // NEW — task 3 of this step
      ])
      const { genre, styleTags } =
        classRes.status === 'fulfilled'
          ? classRes.value
          : { genre: 'other', styleTags: [] }
      ```
      `classifyPrompt` never rejects (per task 2), so the
      `rejected` branch should be unreachable; keep the fallback
      for type-safety.
    - Persist genre:
      ```
      await db.update(games).set({ genre, updatedAt: now() })
        .where(eq(games.id, gameId))
      ```
    - Persist title (only on success — placeholder remains
      otherwise, per SPEC §7):
      ```
      if (titleRes.status === 'fulfilled') {
        await db.update(games).set({ title: titleRes.value, updatedAt: now() })
          .where(eq(games.id, gameId))
      } else {
        request.log.warn({ err: titleRes.reason },
          'title generation failed; keeping placeholder')
      }
      ```
      Both updates run before Sonnet streaming begins. The
      frontend reflects the new title via the next
      `GET /api/games/:id` refetch or dashboard reload (SPEC §7
      — no separate SSE push).
   - Pass classified `genre` into the existing retrieval helper:
     ```
     const example = await retrieveExample({
       embedding: embedRes.status === 'fulfilled' ? embedRes.value : null,
       genre,
     })
     ```
   - Replace the previous `GENERATION_SYSTEM_PROMPT` reference
     with a builder call:
     ```
     const systemPrompt = buildGenerationSystemPrompt({
       genre, styleTags, example,
     })
     ```
   - Pass `systemPrompt` into the existing `streamGame` /
     `streamText` call. No change to streaming, persistence,
     concurrency Set, or abort wiring.

8. **Update step 9's retrieval helper signature.**
   `apps/server/src/services/rag/retrieve.ts` (or wherever step 9
   landed) — accept `{ embedding: number[] | null, genre: string }`
   (matches plans/09 task 13 verbatim). The consumer call site is
   `retrieveExample({ embedding, genre })` where `embedding:
   number[] | null`.
   - If `embedding` is null → return `null` (no few-shot;
     embedding call failed).
   - If `genre === 'other'` → run the global nearest-neighbor
     query (no genre WHERE clause).
   - Else → add `WHERE genre = ?` to the vec0 subquery (SPEC §8
     query template, verbatim).
   This is a small extension to the existing helper, not a
   rewrite. Tests/manual checks already exist from step 9 for
   the `other` / global path.

### Server — wiring

9. **Imports and exports.**
   - Re-export `GENRE_BUCKETS` and `GenreBucket` from
     `packages/shared/src/index.ts` (or whatever the package
     entrypoint is).
   - Make sure `apps/server/src/services/llm/prompts/generation/
     index.ts` is imported only from `routes/games.ts` (the only
     consumer in this step).

## Verification steps

Manual end-to-end checks. Run after `bun run dev` is up.

1. **One prompt per genre persisted correctly.**
   Submit each of the following via the `/game/new` UI and verify
   the resulting `games.genre` row:

   | Prompt | Expected `genre` |
   |---|---|
   | "make a pong-style paddle game with two paddles" | `paddle` |
   | "snake game where eating food grows the tail" | `snake` |
   | "flappy bird clone, tap to flap" | `flappy` |
   | "top-down space shooter with enemy waves" | `shooter` |
   | "Mario-style platformer with jumping and pits" | `platformer` |
   | "sliding-tile puzzle, 4x4 grid" | `puzzle` |
   | "endless runner where you dodge obstacles" | `runner` |
   | "tamagotchi-like virtual pet simulator" | `other` |

   For each: open SQLite (`sqlite3 apps/server/data/arcadeai.db`)
   and run
   `SELECT id, title, genre FROM games ORDER BY created_at DESC LIMIT 1;`.
   Confirm `genre` matches the expected bucket above. Also confirm
   `title` is **not** the placeholder slice (first 40 chars of the
   prompt) — title generation should overwrite it within ~5 s of
   stream completion (verified more thoroughly in step 3 below).

2. **Title generation persists.**
   Submit `"make a pong-style paddle game with two paddles"`. Wait
   for the SSE stream to finish (`done` event) plus ~2 seconds.
   Query:
   `SELECT title FROM games ORDER BY created_at DESC LIMIT 1;`.
   - Title is a coherent short string (e.g. "Two-Paddle Pong",
     "Paddle Duel"), **not** the placeholder
     `"make a pong-style paddle game with"` (40-char slice).
   - Title length ≤ 80 characters.

   Then force a title-gen failure: temporarily edit
   `generateTitle` to `throw new Error('test')` at the top.
   Restart, submit a new prompt, and confirm:
   - The new row's `title` equals the placeholder (40-char slice).
   - Server log shows a single WARN line:
     `title generation failed; keeping placeholder`.
   - Generation completes end-to-end (no 5xx, SSE `done` fires).
   Revert the stub.

3. **Classification failure path.**
   Temporarily edit `classifyPrompt` to throw at the top of the
   function (`throw new Error('test')`) — or stub
   `generateObject` to return `{ genre: 'invalid', style_tags: []
   }`. Restart the server. Submit any prompt:
   - Server log shows a single WARN line:
     `genre classification failed; defaulting to other` (or
     equivalent) with the error.
   - `games.genre` for the new row is `'other'`.
   - The Sonnet generation completes successfully and a playable
     game lands in the iframe.
   - No 5xx returned to the client; the SSE stream completes with
     a `done` event.
   Revert the test stub.

4. **Parallelism check.**
   Add `console.time` / `console.timeEnd` (or a temporary log
   line) at the start of each of the three branches
   (`classifyPrompt`, `embedPrompt`, `generateTitle`) and at the
   `Promise.allSettled` resolution. Submit a prompt. Confirm:
   - All three start times are within ~5 ms of each other.
   - The `allSettled` resolves at roughly the time of the slowest
     branch (not the sum).
   Remove the temporary logs.

5. **Genre-aware retrieval.**
   Submit `"flappy bird clone, tap to flap"`. With the server log
   level at `debug` (or with a temporary log inside
   `retrieveExample`), confirm:
   - The retrieval query's WHERE clause includes `genre = 'flappy'`.
   - The returned example's id corresponds to a `rag_examples` row
     with `genre = 'flappy'` (verify via SQLite).

   Submit `"tamagotchi-like virtual pet simulator"`. Confirm:
   - `genre = 'other'` is persisted.
   - The retrieval query runs without a `WHERE genre = ?` filter
     (SPEC §6 — global nearest-neighbor for `other`).

6. **Style tag injection.**
   Submit `"a retro neon arkanoid clone with chiptune feel"`.
   Either:
   - Log `systemPrompt` once before the Sonnet call (temporary), or
   - Set a breakpoint and inspect.

   Confirm the assembled system prompt:
   - Contains the `BASE_GENERATION_CONTRACT` text.
   - Contains the `paddle.ts` extension.
   - Contains a `Style guidance: …` line listing tags including
     at least `retro` and `neon`.
   - Empty `styleTags` (e.g. from the failure-path test in step 3)
     produces a system prompt with **no** `Style guidance:` line.

7. **Generation does not block on classification failure.**
   Use the failure stub from step 3. Submit a prompt and verify
   end-to-end:
   - Classification fails (WARN logged).
   - Embedding succeeds, retrieval still runs (with `genre =
     'other'` → global nearest-neighbor).
   - Title gen succeeds.
   - Sonnet streams.
   - Client receives `meta` → `chunk` → `done` and renders a
     playable game.
   No path through the handler can short-circuit on a
   classification error.

8. **Refinement does not re-classify.**
   On a generated game, submit a refinement (e.g. "make it
   harder"). Confirm in logs / network that no
   `gpt-4.1-mini` JSON-mode call is made on the refinement path —
   only the existing summarization (if triggered) and Sonnet
   refinement call. `games.genre` and `games.title` are unchanged
   after refinement.

9. **Build & lint (AGENTS.md pre-commit gate).**
   - `bun run build` (typecheck both workspaces).
   - `bun run check` (Biome).
   - Both pass before committing.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — Classification + title services

After the **Shared**, **Server — classification service**, **Server — title generation**, and **Server — pipeline integration** / **wiring** tasks complete and the pre-commit gate passes:

```
feat(llm): add genre classification, style tags, and title generation
```

Includes: `packages/shared/src/genres.ts`, `apps/server/src/services/llm/classify.ts`, `apps/server/src/services/llm/title.ts`, and the pipeline wiring that classifies before generation and persists genre/style tags + title on the game row.

### Checkpoint 2 — Prompt variants

After the **Server — prompt variants** tasks complete (split base contract from per-genre prompts) and the pre-commit gate passes:

```
feat(prompts): split base contract from per-genre variants
```

Includes: the base prompt contract module and the per-genre prompt variant files used by the generation pipeline.

## Rollback notes

- New files are additive:
  - `packages/shared/src/genres.ts`
  - `apps/server/src/services/llm/classify.ts`
  - `apps/server/src/services/llm/title.ts`
  - `apps/server/src/services/llm/prompts/base.ts`
  - `apps/server/src/services/llm/prompts/generation/{paddle,snake,
    flappy,shooter,platformer,puzzle,runner,other,index}.ts`

  Deleting them removes the genre-aware classification, the
  title-generation call, and the per-genre prompt surface.

- **Prompts directory reorganization rollback.** Task 4 deletes
  `apps/server/src/services/llm/prompts/generation.ts` (step 4's
  monolithic file) after splitting its content between
  `prompts/base.ts` and `prompts/generation/index.ts`. To revert:
  copy `prompts/base.ts` content back into a recreated
  `prompts/generation.ts`; if step 9's few-shot wrapper was lifted
  into `prompts/generation/index.ts`, copy that back too;
  delete the entire `prompts/generation/` directory; restore the
  original `GENERATION_SYSTEM_PROMPT` import in `routes/games.ts`.

- Edits to existing files:
  - `apps/server/src/routes/games.ts` — the
    `Promise.allSettled` block (now including `generateTitle`),
    the genre + title persistence updates, and the
    `buildGenerationSystemPrompt` call replace the previous
    serial / fixed-prompt construction. Revert by restoring the
    previous `GENERATION_SYSTEM_PROMPT` import, removing the
    title persistence write (placeholder stays), and the prior
    retrieval-call signature.
  - Step 9's `retrieveExample` helper — added a `genre` param.
    Revert by removing the param and the conditional WHERE
    clause; the global-nearest-neighbor branch is the original
    behavior.

- **Title generation rollback.** Removing
  `apps/server/src/services/llm/title.ts` and the corresponding
  `Promise.allSettled` branch + persistence block in
  `routes/games.ts` returns the system to the step-4 placeholder-
  only behavior. No schema change is needed — `games.title` is
  already populated with the placeholder at row creation.

- No schema migrations. `games.genre` column already exists
  (SPEC §5 / step 3) and was simply unwritten before this step.
  Existing rows with `genre IS NULL` remain valid; this step
  starts populating the column on new generations only. No
  backfill is required (nothing reads `games.genre` for existing
  rows yet).

- No new env vars. `OPENAI_API_KEY` is already required by step
  6 for code summarization (SPEC §15).

- No new dependencies. `ai` and `@ai-sdk/openai` are already
  installed (steps 4 and 6). `zod` is already used for request
  validation across the server.

- `usage_log` and `users.credits_remaining_*` are untouched —
  classification cost is folded into the flat 200-credit
  generation charge per SPEC §10 / §18.

- The classification call is the only new outbound network
  dependency in the generation pipeline. If GPT-4.1-mini becomes
  unavailable, every classification falls back to `other` and
  the rest of the pipeline continues — no rollback is needed for
  upstream outages, only observability (the WARN log rate spikes).
