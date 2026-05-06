# 10 — Genre classification + style tags

## Overview

Add a GPT-4.1-mini classification step to the generation pipeline that
returns `{ genre, style_tags }` for the user's prompt (SPEC §6, §19).
The classifier runs in parallel with the embedding call and a
GPT-4.1-mini title-generation call that this step also lands (SPEC §7
pipeline diagram), persists the resolved genre to `games.genre`
(SPEC §5), narrows step 9's RAG retrieval to examples in that genre
bucket (SPEC §6, §8), and feeds the genre into the system-prompt
builder so a genre-specific Sonnet variant is selected with the
extracted style tags injected as aesthetic guidance (SPEC §13). Any
failure of the classifier — network error, malformed JSON, invalid
genre, schema mismatch — falls back to `genre='other'` /
`style_tags=[]`, logs at WARN, and lets the pipeline continue
(SPEC §6 — "Generation should never block on classification
failure").

This step finishes the SPEC §7 generation pipeline contract: after
step 9 wired RAG retrieval with a hardcoded genre/global path, step
10 makes retrieval and prompt selection genre-aware end to end.

Per SPEC §19 step 10's build-order note, this step also owns the
parallel GPT-4.1-mini title-generation call (PATCH `/api/games/:id`
when complete) called out in SPEC §7. Until this step ships, games
keep their placeholder title (first 40 chars of the prompt).

## Goals

- Classification service module that issues a single GPT-4.1-mini
  structured-output call and returns
  `{ genre: GenreBucket, styleTags: string[] }` (SPEC §6).
- The 8 genre buckets are the single source of truth in
  `packages/shared/src/genres.ts` (SPEC §6 — `paddle, snake, flappy,
  shooter, platformer, puzzle, runner, other`). Re-used by the
  classifier's response schema, the prompt-variant registry, and the
  RAG retrieval filter.
- Zod schema validates the model's response shape; an invalid
  response is treated identically to a network failure — fall back
  to `other` / `[]` and log WARN with the raw response (SPEC §6).
- The classifier runs **in parallel** with the existing embedding
  call and the existing title-generation call inside `POST
  /api/games`, via `Promise.allSettled` so a failure of any one
  branch does not abort the others (SPEC §7 pipeline diagram).
- The resolved `genre` (post-fallback) is persisted to
  `games.genre` (SPEC §5) before Sonnet streams begin, so the
  dashboard / future features can read it from the row.
- Step 9's RAG retrieval query takes a `genre` parameter and uses
  it as a filter; `genre='other'` falls back to global
  nearest-neighbor with no genre filter (SPEC §6, §8).
- Genre-aware system-prompt builder: generation prompts live under
  `apps/server/src/services/llm/prompts/generation/` keyed by
  genre, with a `base.ts` shared contract (SPEC §13). The builder
  picks the variant for the classified genre, falls back to a
  default variant for `other`, and appends a style-tags block to
  the assembled system prompt as aesthetic guidance.
- Style tags are **prompt guidance only** — never used to filter
  RAG retrieval (SPEC §6 — "Injected into the Sonnet system prompt
  as guidance, not used for retrieval").
- Refinement (SPEC §16) and repair (step 11) paths are **not**
  modified in this step; classification is a generation-pipeline
  concern.

## Non-goals (explicitly deferred)

- **No learned classifier, no fine-tune, no rules-based fallback
  before the LLM call.** SPEC §6 commits to a single GPT-4.1-mini
  structured-output call. We do not pre-classify with regex on the
  prompt or short-circuit obvious cases.
- **No per-style RAG retrieval.** Style tags are aesthetic guidance
  injected into the system prompt only. RAG retrieval is filtered
  by genre exclusively (SPEC §6, §8).
- **No user-facing genre picker.** SPEC §12 does not surface genre
  selection in the UI. The classified genre is server-side state
  the user does not see or edit.
- **No re-classification on refinement.** Refinement reuses the
  already-classified `games.genre`; SPEC §16's refinement context
  does not include classification, and SPEC §13 specifies the
  refinement system prompt is a single variant (not genre-keyed).
  Step 6 already shipped a single refinement system prompt and
  this step does not change that.
- **No genre persistence on classification failure as `null`.**
  SPEC §6's failure contract is `genre='other'`, and that string
  is persisted to `games.genre` so downstream code never has to
  handle a `null` genre. The DB column remains nullable per the
  step-3 schema for legacy rows, but this step always writes a
  concrete value.
- **No style-tag persistence.** SPEC §5's `games` table has no
  column for style tags. They're consumed by the prompt builder
  in-memory and discarded after generation. SPEC §6 treats them
  as transient prompt guidance, not persisted state.
- **No credit cost for classification.** SPEC §10 prices
  generation flat at 200 credits and §18 includes the GPT-4.1-mini
  classify cost inside that envelope. No separate `usage_log` row
  for classification.
- **No structured Pino logging beyond a single WARN on failure.**
  Full LLM-call cost/latency logging (SPEC §14 — `requestId,
  model, tokens_in, ...`) is step 13.
- **No client-side surface for the `genre` field.** SPEC §12's
  dashboard card content is `id, title, thumbnail, updated_at`;
  genre is server-internal in this step. The `GET /api/games/:id`
  response can include it (it's already a column) but no UI uses
  it.

## Architecture

### Server side

```
POST /api/games  (Zod-validated body { prompt: string })
    │
    ├─ session check, concurrency acquire (existing from step 4)
    ├─ insert games row { id, user_id, title=placeholder,
    │                     current_code='', original_prompt=prompt,
    │                     genre=null, ... }   // genre filled below
    ├─ insert messages row { kind:'prompt', content:prompt }
    │
    ├─ writeSSEHeaders; write SSE 'meta' { gameId, placeholderTitle }
    │
    ├─ const [classification, embedding, title] = await Promise.allSettled([
    │       classifyPrompt(prompt),       // NEW — this step
    │       embedPrompt(prompt),          // existing — step 9
    │       generateTitle(prompt),        // NEW — this step (SPEC §7, §19 step 10)
    │     ])
    │
    │     classifyPrompt resolves to { genre, styleTags } or to
    │     { genre: 'other', styleTags: [] } via its own internal
    │     try/catch + Zod parse + WARN log. It never rejects.
    │
    ├─ const { genre, styleTags } = classification.value     // safe — never rejects
    ├─ UPDATE games SET genre = ? WHERE id = ?               // persist before Sonnet
    │
    ├─ if (title.status === 'fulfilled') {                   // title-gen success
    │     UPDATE games SET title = ? WHERE id = ?            // overwrite placeholder
    │   } else {
    │     log.warn({ err: title.reason }, 'title generation failed; keeping placeholder')
    │   }
    │
    ├─ const example = await retrieveExample({                // step 9, now genre-aware
    │     embedding: embedding.status === 'fulfilled' ? embedding.value : null,
    │     genre,
    │   })
    │
    ├─ const systemPrompt = buildGenerationSystemPrompt({     // NEW — genre-aware
    │     genre,
    │     styleTags,
    │     example,
    │   })
    │
    ├─ stream Sonnet with `systemPrompt` + user prompt → SSE 'chunk' …
    └─ on completion: persist current_code, write 'done', release(userId)
```

Key shape: classification is one of three branches in a single
`Promise.allSettled`. Sonnet streaming **must not start** until
all three settle, because the system prompt depends on `genre`,
`styleTags`, *and* the retrieved RAG example (which itself needs
the embedding). Step 7's pipeline diagram shows these three
GPT-4.1-mini / embedding calls as parallel siblings preceding the
Sonnet call, not as a fire-and-forget background. We honor that
ordering: parallel start, single await, then Sonnet.

### Classification service

```
apps/server/src/services/llm/classify.ts

  classifyPrompt(prompt: string): Promise<{
    genre: GenreBucket
    styleTags: string[]
  }>
```

Implementation outline:

1. `generateObject` from the AI SDK against `openai(MINI)` with
   `mode: 'json'` (structured output / JSON mode per SPEC §6).
2. The `schema` argument is a Zod object:
   ```
   z.object({
     genre: z.enum(GENRE_BUCKETS),         // 8-tuple from shared
     style_tags: z.array(z.string()).max(5)
   })
   ```
   `max(5)` is a soft cap to keep injected guidance terse — SPEC §6
   gives free-form descriptors like `retro`, `neon`, `minimal`,
   `cute`, `dark`; five is enough headroom.
3. Fixed system prompt (lives next to the function — short enough
   to inline; not a separate `prompts/` file): "Classify the user's
   game prompt into one of these genres: paddle, snake, flappy,
   shooter, platformer, puzzle, runner, other. Use 'other' if
   uncertain. Also extract up to 5 short aesthetic descriptors
   (e.g. retro, neon, minimal, cute, dark)." User message: the
   prompt itself.
4. Wrap the entire call in try/catch. On any throw — network
   error, JSON parse failure, Zod validation failure (the AI SDK
   surfaces validation errors as throws when `mode: 'json'` is
   used with a Zod schema) — log at WARN with
   `{ err, rawResponse? }` and return
   `{ genre: 'other', styleTags: [] }` (SPEC §6).
5. Even though Zod's enum constrains `genre`, defense-in-depth:
   if the post-parse `genre` is somehow not in `GENRE_BUCKETS`
   (e.g. SDK upgrade changes behavior), coerce to `'other'`.
6. The function's return type is exactly `{ genre, styleTags }` —
   never throws — so the caller does not need a `.catch`.

### Title generation service

```
apps/server/src/services/llm/title.ts

  generateTitle(prompt: string): Promise<string>
```

Implementation outline:

1. `generateText` from the AI SDK against `openai(MINI)` — single
   non-streaming call. SPEC §7 places this in the parallel fanout
   alongside classification and embedding.
2. System prompt: "Generate a concise, descriptive game title for
   the user's prompt. Return only the title — no quotes, no
   punctuation, no preamble. Maximum 80 characters." User message:
   the prompt itself.
3. Trim the response and slice to 80 characters as a hard cap
   (matches the existing `games.title` bound enforced in step 5's
   PATCH validator).
4. The function may throw on network/SDK error; the caller
   (`Promise.allSettled`) treats a rejection as "keep placeholder."
   No internal try/catch — failure handling is at the call site.

Persistence: when title resolves, the `POST /api/games` handler
runs `UPDATE games SET title = ? WHERE id = ?` synchronously,
before Sonnet streams (same critical section as the genre
update). The frontend reflects the new title via the next
`GET /api/games/:id` refetch or dashboard reload — no separate
SSE push, per SPEC §7's note that "Final title arrives later …
next `GET /api/games/:id` reflects it."

Failure handling: on title-gen failure, leave the placeholder
title in place. Log a single WARN with the error; do not block
generation, do not retry.

### Genre-keyed prompt variants

Directory layout (extends step 4's `apps/server/src/services/
llm/prompts/generation.ts`):

```
apps/server/src/services/llm/prompts/
  base.ts                  // SPEC §13 base contract — shared
  generation/
    index.ts               // buildGenerationSystemPrompt + registry
    paddle.ts
    snake.ts
    flappy.ts
    shooter.ts
    platformer.ts
    puzzle.ts
    runner.ts
    other.ts               // generic fallback
  refinement.ts            // existing — unchanged in this step
```

- `base.ts` exports `BASE_GENERATION_CONTRACT` — the §13 base
  rules (single complete HTML, required structure, procedural
  assets, wrapped game loop, self-contained, etc.) lifted out of
  step 4's monolithic prompt.
- Each genre file exports a `string` (or a function returning a
  string) with genre-specific extensions to the base contract.
  E.g. `flappy.ts` adds: "single-button input, gravity simulation,
  infinite scrolling obstacles" (SPEC §13 example, verbatim).
  `other.ts` exports the empty-extension case (just the base).
- `generation/index.ts` exports
  `buildGenerationSystemPrompt({ genre, styleTags, example })`
  which:
  1. Looks up the variant in a `Record<GenreBucket, string>`.
  2. Concatenates `BASE_GENERATION_CONTRACT` + variant + the
     RAG example block (existing step-9 format) + the style-tags
     block.
  3. Style-tags block format (only emitted if `styleTags.length
     > 0`):
     ```
     Style guidance: <comma-separated tags>
     ```
     Terse — SPEC §6 calls these "aesthetic guidance, not retrieval
     filter," so a one-line append is sufficient.
- The registry keys are validated against `GENRE_BUCKETS` at module
  load (a small TS exhaustiveness check — `Record<GenreBucket,
  string>` makes this a compile-time guarantee, no runtime
  assertion needed).

### RAG retrieval integration

Step 9 already wired retrieval; this step adjusts its signature.

```
retrieveExample({ embedding, genre }) → string | null
  if embedding is null:                       // embedding call failed
    return null                               // skip few-shot (graceful)
  if genre === 'other':
    SELECT html FROM rag_examples WHERE id IN (
      SELECT id FROM rag_embeddings
      ORDER BY vec_distance_cosine(embedding, ?) LIMIT 1
    )
  else:
    SELECT html FROM rag_examples WHERE id IN (
      SELECT id FROM rag_embeddings
      WHERE genre = ?                         // already in vec0 row
      ORDER BY vec_distance_cosine(embedding, ?) LIMIT 1
    )
```

Note: SPEC §8 spells the genre-filtered query out exactly. The
`other`-genre branch is the global-nearest-neighbor fallback
(SPEC §6 — "`other` falls back to no genre filter").

If step 9 instead stored `genre` only on `rag_examples` (not
`rag_embeddings`), the WHERE clause moves to a join — the design
doesn't depend on which table it lives on, and the plan defers to
step 9's actual schema.

### Persistence

- `games.genre` is updated **once**, between
  `Promise.allSettled` settling and Sonnet streaming.
- The update is a single `UPDATE games SET genre = ? WHERE id = ?`
  with the resolved bucket (always one of the 8, never `null`).
- No new column on `games`. SPEC §5 already declares
  `genre text` (nullable) on `games`. Step 3 created it; this
  step starts populating it.

### Frontend

No frontend changes in this step. SPEC §12 surfaces `id, title,
thumbnail, updated_at` on dashboard cards and does not display
`genre`. The streaming UX is identical from the client's view —
classification adds a small constant latency before the first
Sonnet `chunk` arrives, bounded by the slowest of the three
parallel calls (the embedding call is typically the fastest;
classification and title gen are both ~150–300 ms GPT-4.1-mini
roundtrips).

## Key decisions

### Why `generateObject` with Zod (structured JSON output)

SPEC §6 specifies "structured output / JSON mode" returning
`{ genre, style_tags }`. The AI SDK's `generateObject` with
`mode: 'json'` and a Zod schema is the most direct expression of
that: the SDK enforces JSON mode at the API level, parses, and
validates against the schema in one call. The alternative —
`generateText` then `JSON.parse` then manual `z.parse` — is
strictly more code and more failure modes for no benefit. Zod
also gives us the genre enum constraint for free, so an invalid
genre from the model becomes a parse failure (caught and
fall-backed) rather than silent data corruption downstream.

### Why parallel with the other GPT-mini calls

SPEC §7's pipeline diagram explicitly draws classification,
embedding, and title generation as three parallel branches before
Sonnet. Sequential would add ~500–900 ms to first-byte latency
(three roundtrips × ~200–300 ms each) for no quality gain — the
calls are independent. `Promise.allSettled` is the right primitive
because we want the union of partial successes: a failed embedding
should not block classification, and a failed classification
should not block embedding. Each branch already has its own
internal fallback (classify → `other`, embed → `null` so RAG
skips, title → placeholder remains), so `allSettled` + per-branch
defaults is the cleanest expression.

### Why fall back to `other` on any malformed response

SPEC §6 commits to a generation-must-not-block contract:
"Generation should never block on classification failure." That
means the classifier must be a total function from the caller's
perspective — never throw, always return a usable bucket. `other`
is well-defined for the rest of the pipeline (RAG falls back to
global nearest-neighbor; the prompt builder picks `other.ts`
which is the base contract with no genre extensions; style tags
are empty so no guidance block is appended). Any other failure
mode (partial result, retry-with-backoff, fast-path heuristic)
adds complexity to an already-graceful path. A single WARN log
preserves observability so we can track failure rate without
adding code paths.

### Why style tags are guidance, not a retrieval filter

SPEC §6 makes this an explicit design call: "Free-form aesthetic
descriptors … injected into the Sonnet system prompt as guidance,
not used for retrieval." Using style tags as a retrieval filter
would shrink the retrievable corpus to near-zero per query
(combinatorial filter on a ~20-game library), defeat the genre
filter's purpose, and require a tagged corpus we don't have.
Treating them as a free-form guidance string lets the model use
them however it sees fit without us building a tag taxonomy or
re-tagging the RAG library when descriptors evolve.

### Why genre is persisted but style tags are not

`games.genre` is useful as long-term state: future analytics, a
possible "browse by genre" surface, refinement-time logic that
re-uses the original classification. Style tags, by contrast, are
prompt-time aesthetic shorthand specific to one generation — they
don't durably describe the game (the game's actual visual style
emerges from Sonnet's interpretation, which may diverge from the
tags) and SPEC §5 doesn't declare a column for them. Storing them
would be speculative schema; not storing them costs nothing
(re-classification of the original prompt is cheap if we ever
need them again).

### Why classification doesn't run on refinement

SPEC §16's refinement context recipe (original prompt + past
feedback bullets + current code + current request) deliberately
omits classification, and SPEC §13 specifies a single refinement
system prompt (not genre-keyed). The original prompt's genre
already classified into `games.genre`; if a refinement request
fundamentally changes the genre ("turn this paddle game into a
shooter"), SPEC §13 already grants Sonnet permission to rewrite
from scratch. Re-classifying on refinement would add latency and
cost without clear benefit, and would risk the refinement system
prompt drifting between turns.

## Open questions

1. **Should the style-tag block be injected before or after the
   RAG example in the assembled system prompt?**
   Tentative: after the example (so the most recent guidance is
   closest to the user's prompt in the LLM's attention). Verify
   empirically once a few generations are observable.

2. **Should we re-classify if a generation is regenerated via the
   "Regenerate" button (SPEC §12)?**
   SPEC §12 says Regenerate "re-runs the original prompt as a
   fresh generation." Strict reading: it's a fresh generation,
   so it re-classifies. Pragmatic reading: the prompt is identical,
   so the result will be identical (modulo model nondeterminism).
   Lean strict — re-classify — for code simplicity (one path, not
   two) and accept the trivial extra cost (~$0.0001 per regenerate).

3. **Cap on style-tag count.** SPEC §6 examples list five
   descriptors; we cap at 5 in the Zod schema. If real prompts
   produce useful longer tag sets, raise to 8. No reason to
   over-engineer this now.

4. **`generateObject` vs `streamObject`.** Classification is small
   and downstream consumers need the full result before Sonnet
   starts; non-streaming is correct. Flagged only because step 4's
   pattern is `streamText` and consistency might tempt a streaming
   call here. Don't.

## Acceptance criteria

- [ ] `packages/shared/src/genres.ts` exports
      `GENRE_BUCKETS` (the 8-tuple per SPEC §6) and a derived
      `GenreBucket` type. The classification Zod schema, the
      prompt-variant registry, and the RAG retrieval filter all
      reference this same constant.
- [ ] `apps/server/src/services/llm/classify.ts` exports
      `classifyPrompt(prompt) → Promise<{ genre, styleTags }>`
      that **never throws** — internal try/catch returns
      `{ genre: 'other', styleTags: [] }` on any error, with a
      WARN log including the raw response or error.
- [ ] Submitting a prompt that obviously belongs to each of the 8
      buckets (one prompt per bucket — see plan verification)
      results in `games.genre` persisted as that bucket. (`other`
      is verified with a deliberately weird prompt.)
- [ ] Forcing a malformed response in dev (e.g. by stubbing the
      classifier to return `{ genre: 'invalid' }` once) results
      in `games.genre = 'other'`, `style_tags=[]` guidance, a
      WARN log, and a successful Sonnet generation that completes
      end-to-end.
- [ ] `POST /api/games` runs classification, embedding, and title
      generation in parallel — observable via overlapping LLM
      log entries with the same `requestId` (full structured
      LLM logging is step 13, but timing is observable from the
      step's local console).
- [ ] Step 9's RAG retrieval is invoked with the classified
      `genre`. For `genre !== 'other'` the retrieved example's
      stored genre matches; for `genre === 'other'` the query
      runs without the genre filter.
- [ ] The Sonnet system prompt for a non-`other` genre includes
      both the genre-specific extension and the style-tags
      guidance line (when `styleTags.length > 0`). Verified by
      logging the assembled system prompt in dev.
- [ ] A refinement turn on a previously-generated game does NOT
      re-invoke `classifyPrompt`. (Step 6's refinement handler is
      unchanged.)
- [ ] Submitting a generation prompt produces a `games.title` that
      is NOT the placeholder slice (first 40 chars of the prompt)
      within ~5 seconds of the LLM stream completing, assuming the
      title-generation call succeeded. On title-gen failure, the
      placeholder remains and a single WARN is logged.
- [ ] `bun run build` and `bun run check` pass (AGENTS.md
      pre-commit gate).
