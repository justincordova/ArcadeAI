# 09 — RAG library

## Overview

Wire the curated reference-game library into the generation pipeline so
every Sonnet call receives one concrete, hand-vetted few-shot example.
The work splits cleanly into two coordinated workstreams that share only
the `rag_examples` + `rag_embeddings` tables:

- **Workstream A — Library creation (build-time).** A small set of
  scripts in `apps/server/scripts/` drafts ~20 reference games with
  Claude Opus 4.7, walks them through an editorial pass, generates
  1536-dim embeddings via `text-embedding-3-small`, and seeds the two
  tables. Runs once (and again whenever the curated set is revised).
  Opus 4.7 is **build-time only** per SPEC §3 / §8.
- **Workstream B — Runtime integration.** Load the `sqlite-vec`
  extension at db-client init via `db.loadExtension()`, add a
  retrieval service that runs the single SQL query from SPEC §8,
  and replace step 4's hardcoded system prompt with a RAG-augmented
  prompt that injects the retrieved example as a few-shot reference.

This step does not introduce genre classification — that lands in
step 10 (SPEC §19). Until step 10 supplies a real classified genre,
the retrieval call accepts a stub `genre = 'other'`, which per SPEC
§6 / §8 falls back to global nearest-neighbor across the whole
library. The retrieval service signature is shaped now so step 10 only
has to pass a real genre string; no callsite churn.

Runtime model selection is unchanged: Claude Sonnet 4.6 remains the
runtime model for all user-facing generation, refinement, and repair
(SPEC §3, §13). Opus 4.7 never executes at runtime.

## Goals

- `sqlite-vec` extension loaded at db-client construction time via
  `db.loadExtension(...)`, so `vec_distance_cosine` and the `vec0`
  virtual-table machinery are available everywhere the shared db
  client is imported (SPEC §3, §5, §19).
- Post-migrate `vec0` table from step 1 (SPEC §19 step 1) is verified
  to exist; if it does not, the post-migrate step is invoked. The
  CREATE statement matches SPEC §5 verbatim:
  `CREATE VIRTUAL TABLE IF NOT EXISTS rag_embeddings USING vec0(id text primary key, genre text, embedding float[1536])`.
  The `genre` column is a vec0 metadata column duplicated from
  `rag_examples.genre` so the SPEC §8 retrieval query filters and
  ranks in a single statement without a join. Step 1's existing
  post-migrate script is updated in place to add `genre` — not
  duplicated here.
- `rag_examples` is populated with ~20 hand-curated rows (~2–3 per
  genre bucket, the eight buckets from SPEC §6). Each row has a
  matching `rag_embeddings` row keyed by `id` (SPEC §5, §8).
- A `retrieveExample({ embedding, genre })` service runs the
  single SQL query from SPEC §8 and returns the full HTML of the
  nearest reference. `genre = 'other'` (or any value not in the
  eight buckets) skips the genre filter (SPEC §6, §8).
- The generation pipeline in `POST /api/games` calls
  `text-embedding-3-small` on the user's prompt, passes the embedding
  + a stub `genre = 'other'` to the retrieval service, and injects
  the returned HTML into Sonnet's system prompt as a few-shot
  reference (SPEC §7, §13). Embedding runs in parallel with any other
  pre-LLM work the pipeline already does, matching the parallel
  layout in SPEC §7.
- **Exactly 1 example** retrieved per request, **full code**
  injected (no skeletons). SPEC §8 is explicit on both points.
- Build-time scripts are idempotent: re-running the seed script
  replaces existing rows by `id` rather than duplicating.

## Non-goals (explicitly deferred)

- **No automatic library expansion.** The library is curated, not
  self-growing. Generated user games are never re-embedded back into
  `rag_examples`. SPEC §8 commits to a fixed ~20-game curated set.
- **No genre classification in this step.** GPT-4.1-mini classification
  and per-genre prompt variants land in step 10 (SPEC §19). For now
  the retrieval call uses a stub `genre = 'other'`, exercising the
  global-nearest-neighbor fallback path on every request.
- **No multi-example retrieval, no skeletons.** SPEC §8 explicitly
  rejects both: two examples confuse the model and double input
  tokens; skeletons lose the concrete pattern that makes few-shot
  work.
- **No retrieval over message history, refinement context, or
  generated games.** Refinement (step 6) does not retrieve; it uses
  the existing code as context per SPEC §16. RAG is generation-only.
- **No reranking, no hybrid lexical+vector search.** Cosine distance
  on `text-embedding-3-small` embeddings is the entire ranking
  function (SPEC §8).
- **No embedding cache for user prompts.** Each generation re-embeds
  the prompt. Embedding is ~$0.0001 per call (SPEC §18) and prompts
  rarely repeat verbatim.
- **No CI gate that re-runs the seed.** The seed script is a manual
  developer action. Re-seeding is a deliberate decision tied to a
  curated-content revision, not a routine build step.
- **No admin UI for managing the library.** Edits happen in the
  source files committed alongside the scripts.

## Architecture

### Workstream A — Library creation (build-time)

Three scripts in `apps/server/scripts/`, run in sequence by a developer
after curating prompts. All three are Bun scripts (`bun run scripts/...`).
They use the existing shared db client and shared model id constants.

```
scripts/draft-rag-examples.ts      (Opus 4.7, build-time only)
    │
    ├─ reads scripts/rag-prompts.ts: the 20 curated prompts +
    │   target genres (a hand-edited TypeScript file checked into
    │   the repo — this is the editorial source of truth)
    │
    ├─ for each entry:
    │     streamText({ model: anthropic('claude-opus-4-7'),
    │                   system: REFERENCE_DRAFT_SYSTEM_PROMPT,
    │                   prompt: entry.prompt })
    │     write apps/server/scripts/rag-drafts/<id>.html
    │
    └─ does NOT touch the database
```

The drafts directory is gitignored (raw model output is not the
authoritative artifact — the curated HTML is).

```
[manual editorial pass]
    │
    └─ developer copies the draft into
       apps/server/scripts/rag-curated/<id>.html, edits to satisfy
       the SPEC §13 base contract (canvas, init/update/render/
       gameLoop, title screen, game over, key state map, procedural
       assets, self-contained, try/catch + postMessage), and verifies
       playability in a browser. The curated directory IS committed.
```

```
scripts/embed-rag-examples.ts      (text-embedding-3-small)
    │
    ├─ reads scripts/rag-prompts.ts + scripts/rag-curated/*.html
    │
    ├─ for each entry:
    │     embedding = embed({
    │       model: openai.embedding('text-embedding-3-small'),
    │       value: entry.prompt
    │     })
    │     write apps/server/scripts/rag-embeddings/<id>.json
    │
    └─ does NOT touch the database
```

Embeddings are also gitignored. They are deterministic enough for the
curated set to live in source control if desired, but the API call is
cheap (~$0.0001 each × 20 = $0.002) so re-embedding on demand is fine.

```
scripts/seed-rag-examples.ts       (writes to SQLite)
    │
    ├─ verifies sqlite-vec is loaded (db.loadExtension already ran
    │   via shared client) and the rag_embeddings vec0 table exists
    │
    ├─ in a transaction:
    │     for each entry:
    │       INSERT OR REPLACE INTO rag_examples
    │         (id, genre, prompt, html, created_at)
    │         VALUES (?, ?, ?, ?, ?)
    │       INSERT OR REPLACE INTO rag_embeddings (id, genre, embedding)
    │         VALUES (?, ?, ?)
    │       -- genre on rag_embeddings is denormalized from
    │       -- rag_examples.genre per SPEC §5 / §8.
    │
    └─ logs counts per genre bucket
```

Idempotent by design: `INSERT OR REPLACE` keyed by `id` lets the seed
script run repeatedly without duplicating rows. Re-curating an example
means re-running embed + seed for that one row.

### Workstream B — Runtime integration

```
packages/db/src/client.ts
    │
    ├─ existing: better-sqlite3 (or bun:sqlite) handle + drizzle wrapper
    │
    └─ NEW: immediately after the handle is created, call
            db.loadExtension(<sqlite-vec path>) before any query runs.
            The extension path comes from the `sqlite-vec` npm package
            (it ships a per-platform binary; the package exports a
            helper to get the path).
```

```
apps/server/src/services/rag/retrieve.ts            (NEW)
    │
    ├─ retrieveExample({ embedding, genre }): Promise<string | null>
    │
    ├─ embedding is serialized to the format sqlite-vec accepts
    │   (Float32Array bytes via the package's helper, or JSON
    │   array — whichever the sqlite-vec docs prescribe for
    │   parameter binding).
    │
    ├─ if genre is one of the 8 SPEC §6 buckets AND genre !== 'other':
    │     SELECT html FROM rag_examples
    │     WHERE id IN (
    │       SELECT id FROM rag_embeddings
    │       WHERE genre = ?
    │       ORDER BY vec_distance_cosine(embedding, ?)
    │       LIMIT 1
    │     )
    │
    │   else (genre === 'other' or unrecognized):
    │     SELECT html FROM rag_examples
    │     WHERE id IN (
    │       SELECT id FROM rag_embeddings
    │       ORDER BY vec_distance_cosine(embedding, ?)
    │       LIMIT 1
    │     )
    │
    └─ returns the html string, or null if the table is empty
        (graceful degrade — pipeline falls back to no few-shot)
```

The single-query shape mirrors SPEC §8 exactly. The `genre` column
on `rag_embeddings` is the vec0 metadata column declared in SPEC §5
(see "Resolved decisions" below).

```
apps/server/src/services/llm/prompts/generation.ts
    │
    ├─ existing: GENERATION_SYSTEM_PROMPT (hardcoded, from step 4)
    │
    └─ NEW: buildGenerationSystemPrompt({ ragExample }): string
            - returns the base contract from SPEC §13
            - if ragExample is non-null, appends a clearly delimited
              "Reference example — build something in this style:"
              section containing the full HTML, fenced or otherwise
              demarcated so Sonnet treats it as a reference, not as
              required content
            - if ragExample is null, returns the base contract alone
              (matches step 4 behavior — safe degrade)
```

```
apps/server/src/routes/games.ts
    │
    └─ POST /api/games (extended from step 4):
         after row creation, before the streamText call:
           [parallel]
             ├─ embedding = embed({ model: 'text-embedding-3-small',
             │                      value: prompt })
             └─ (future: classify genre — step 10. For now: const genre = 'other')
           ↓
           ragHtml = await retrieveExample({
             embedding,
             genre,
           })
           ↓
           system = buildGenerationSystemPrompt({ ragExample: ragHtml })
           ↓
           streamText({ model: SONNET, system, prompt, abortSignal })
```

The `[parallel]` block matches SPEC §7's pre-LLM parallel fanout
(embed + classify + title). Title generation already lives elsewhere
or is deferred; embedding + (stub) classify are the only two pieces
this step adds.

## Key decisions

### Opus 4.7 for drafting only

SPEC §3 explicitly pins Opus 4.7 as **build-time only** and SPEC §8
expands on why: Opus produces meaningfully better long-form code
coherence and structural faithfulness than Sonnet — exactly what
matters for a reference asset that compounds across thousands of
runtime generations. Cost is trivial (~$5 one-time for 20 games).
Runtime continues to use Sonnet 4.6 (SPEC §3, §13). The build-time
script is the only place `claude-opus-4-7` ever appears in the
codebase; nothing in `apps/server/src/services/` imports the Opus
model id. This separation is enforced by file location, not by a
runtime check — the script is not part of the server bundle.

### Exactly 1 example, full code injected

Both choices come straight from SPEC §8. Two examples roughly double
the input token cost and empirically muddle the model's signal
(it tries to interpolate between both styles). One strong, full,
hand-curated example gives Sonnet a concrete pattern to mirror.
Skeletons (function signatures only) lose the concrete shape — the
whole point of few-shot is the surface area of the working code.

### Why post-migrate raw SQL for vec0

SPEC §5 documents that the `vec0` virtual table cannot be expressed
in Drizzle's schema DSL. The post-migrate step in `packages/db/src/
post-migrate.ts` (introduced in step 1) runs the literal CREATE
VIRTUAL TABLE statement after `drizzle-kit migrate`. This step does
not move that logic — it relies on it. If the post-migrate step is
missing or has not been run on the current database file, the seed
script (Workstream A) and the retrieval service (Workstream B) both
fail loudly at first query.

### Genre filter wired before step 10 lands

The retrieval service accepts a `genre` parameter from day one. Until
step 10 runs the classification call, the generation route passes a
literal `'other'`, exercising the SPEC §6 fallback (no genre filter,
global nearest-neighbor). This means:

- The retrieval service is fully tested in this step against real
  data — both the genre-filtered branch (developers can pass any
  bucket manually for verification) and the global-fallback branch
  (the live runtime path).
- Step 10 is purely a "replace the literal `'other'`" change at the
  one callsite in `routes/games.ts`. No retrieval-service edits.
- The retrieval service's contract is locked: its input type is
  `{ embedding: Float32Array | number[]; genre: string }` and
  its only behavioral switch is whether `genre` is one of the 8
  buckets and not `'other'`.

### Extension load location

`db.loadExtension()` runs once at db-client init in `packages/db/src/
client.ts` rather than per-query or per-request. Loading is a
one-time per-connection action; doing it lazily would either repeat
the work or require a flag we don't need. Loading at client
construction means every consumer of the shared client (server
routes, scripts, post-migrate step) gets `vec_distance_cosine`
without further setup.

### Embedding format on the wire

`sqlite-vec` accepts embeddings as Float32 byte buffers (preferred,
binary-stable) or JSON arrays (slower, but human-debuggable). The
`sqlite-vec` npm package ships a helper to convert a `number[]` /
`Float32Array` to the binary format. We use the binary helper in
both the seed script and the retrieval service so the wire format
is identical in both writes and reads.

### Graceful degrade when the library is empty

`retrieveExample` returns `null` (not an error) when the table is
empty or the query yields no rows. The prompt builder treats `null`
as "no few-shot section" and returns the base contract unchanged.
This matches the step-4 behavior exactly, so a fresh checkout that
hasn't seeded the library yet still produces working games — just
without the RAG quality boost. Logged at WARN level once per request
so the gap is visible.

If `embedding` is `null` on input (the embedding call may have failed
in step 10), `retrieveExample` also returns `null` — same graceful
degrade path. Input shape: `{ embedding: number[] | null, genre:
string }`. Internally `number[]` is converted to `Float32Array` via
the `sqlite-vec` helper.

## Resolved decisions

### `genre` column on `rag_embeddings` (vec0 metadata)

SPEC §5 declares `rag_embeddings` as
`vec0(id text primary key, genre text, embedding float[1536])` —
`genre` is a vec0 metadata column duplicated from `rag_examples.genre`.
SPEC §8's example retrieval query uses this column directly:
`SELECT html FROM rag_examples WHERE id IN (SELECT id FROM rag_embeddings WHERE genre = ? ORDER BY vec_distance_cosine(embedding, ?) LIMIT 1)`.
The seed script writes `genre` into both tables. The retrieval
service's filtered branch uses the inner `WHERE genre = ?` shape
verbatim; the global branch drops the WHERE. No JOIN, single SQL,
`LIMIT 1`. The post-migrate CREATE statement is updated in step 1
(SPEC §19 step 1) to include the metadata column — not duplicated
here.

### Curated dir location: `apps/server/scripts/rag-curated/`

The HTML and the seed are runtime-relevant only insofar as the seed
loads them into the db. Placing them in `apps/server/scripts/`
keeps build-time scripts colocated with the server that owns the
db connection. SPEC §8 is silent on this path; sync-docs may
reconcile by recording the location in SPEC §8 later. An alternative
would be `packages/db/scripts/` to colocate with the schema, but
`packages/db` is meant to be a thin schema+client package without
business content.

### Embedding the prompt, not a synthetic description

SPEC §8 retrieves by embedding the user's prompt against an embedding
of the curated `prompt` field on each `rag_examples` row. An
alternative would be to embed a derived description of each game
(e.g. extracted from the HTML). Adopting the SPEC §8 path (embed the
curated prompt) — it's simpler, deterministic, and matches the spec
literally. If retrieval quality is poor in practice we can revisit.

## Acceptance criteria

A reviewer can confirm step 9 is complete when all of the following
hold:

1. `bun run dev` starts the server and the shared db client logs a
   successful `sqlite-vec` extension load on startup. A simple
   `SELECT vec_version()` (or the package's equivalent) returns a
   version string.
2. `apps/server/scripts/draft-rag-examples.ts`,
   `embed-rag-examples.ts`, and `seed-rag-examples.ts` exist and
   each runs end-to-end against real API keys. Drafting uses
   `claude-opus-4-7`; embedding uses `text-embedding-3-small`. The
   draft script writes to a gitignored directory; the curated
   directory is committed.
3. After the seed script runs, `SELECT count(*) FROM rag_examples`
   returns 20 (or whatever the curated set's actual size is) and
   `SELECT count(*) FROM rag_embeddings` returns the same count.
4. `apps/server/src/services/rag/retrieve.ts` exports
   `retrieveExample({ embedding, genre })`. Calling it with
   `genre: 'shooter'` returns the HTML of a shooter example;
   calling it with `genre: 'other'` returns the global nearest
   neighbor; calling it on an empty table returns `null` without
   throwing.
5. `POST /api/games` with a real prompt:
   - calls `text-embedding-3-small` on the prompt
   - calls `retrieveExample` with `genre: 'other'` (stub)
   - injects the returned HTML as a few-shot reference into
     Sonnet's system prompt
   - streams a generated game as before (step 4 behavior preserved)
6. Server logs show, per generation request: an embedding call,
   a retrieval call (with the chosen example's id), and the
   Sonnet stream. No Opus 4.7 calls appear in any runtime log.
7. The curated game files in `apps/server/scripts/rag-curated/`
   each satisfy the SPEC §13 base contract: single complete HTML
   file, `<canvas>`, `init`/`update`/`render`/`gameLoop`, title
   screen + game over, key state map, procedural assets only,
   self-contained, try/catch + parent.postMessage error handler.
   Each plays without errors when opened in a browser.
8. Retrieval is exercised against both branches of the genre
   filter (filtered for `genre in 8 buckets`, global for `'other'`)
   in a manual or scripted check; the SQL query shape matches
   SPEC §8.
9. Step 10 can land by changing the literal `'other'` at one
   callsite to a real classified genre. No retrieval-service
   edits required.
