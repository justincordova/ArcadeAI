# 03 — Game Persistence Foundation

## Overview

Build-order step 3 from SPEC.md §19. Establishes the data layer that step 4
("Single-shot generation") extends. Adds `games` and `messages` tables to the
Drizzle schema, ships the minimum game CRUD endpoints needed for the rest of
the system to compile, and enforces ownership semantics (404 on mismatch per
SPEC.md §14).

This step does **not** invoke any LLM. `POST /api/games` creates the row and
returns it; subsequent steps wrap the generation pipeline around that row
creation (SPEC.md §7, §11, §19 step 4).

## Goals

- `games` table matches SPEC.md §5 column-for-column.
- `messages` table matches SPEC.md §5 column-for-column, including
  `kind in ('prompt' | 'feedback')`.
- `POST /api/games` accepts `{ prompt: string }`, creates a `games` row plus
  a `messages` row (`kind='prompt'`), returns the row as JSON. No SSE, no LLM.
- `GET /api/games/:id` returns the full game (code + ordered messages).
- `DELETE /api/games/:id` hard-deletes the row (cascade removes messages).
- All three routes auth-gated via the Better Auth session middleware from
  step 2 (SPEC.md §14).
- Ownership mismatch returns 404, never 403 (SPEC.md §14).
- Request bodies validated via Zod (SPEC.md §14).
- Drizzle migration generated and applied; `vec0` post-migrate step from
  step 1 still runs cleanly.

## Non-goals

Explicitly deferred — do not implement in this step:

- **No LLM call.** No Sonnet, no GPT-4.1-mini, no embeddings, no SSE. Step 4
  layers streaming generation on top of the row created here (SPEC.md §19
  step 4).
- **No refinement.** `POST /api/games/:id/refine` is step 6 (SPEC.md §19).
- **No thumbnail.** `POST /api/games/:id/thumbnail` is step 5 (SPEC.md §19).
- **No list endpoint.** `GET /api/games` (dashboard list) is step 5
  (SPEC.md §19).
- **No PATCH.** Title rename is step 5 (SPEC.md §19).
- **No `usage_log`, no credit deduction.** Credit model is step 7
  (SPEC.md §19).
- **No `rag_examples` / `rag_embeddings` schema work.** RAG is step 9. The
  `vec0` virtual-table creation script from step 1 is untouched here.
- **No concurrency cap, no rate-limit tightening, no AbortController.** Those
  attach to the streaming endpoint in step 4 (SPEC.md §14, §19 step 4).

## Architecture

### Drizzle schema (`packages/db/src/schema.ts`)

Two new tables added alongside whatever step 2 left in place. All timestamps
are `integer` unix milliseconds per SPEC.md §5.

```ts
export const games = sqliteTable('games', {
  id:              text('id').primaryKey(),                 // uuid
  userId:          text('user_id').notNull()
                     .references(() => users.id, { onDelete: 'cascade' }),
  title:           text('title').notNull(),
  currentCode:     text('current_code').notNull(),          // see Key decisions
  thumbnail:       text('thumbnail'),                       // nullable
  genre:           text('genre'),                           // nullable until step 10
  originalPrompt:  text('original_prompt').notNull(),
  createdAt:       integer('created_at').notNull(),
  updatedAt:       integer('updated_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id:        text('id').primaryKey(),                       // uuid
  gameId:    text('game_id').notNull()
               .references(() => games.id, { onDelete: 'cascade' }),
  kind:      text('kind', { enum: ['prompt', 'feedback'] }).notNull(),
  content:   text('content').notNull(),
  createdAt: integer('created_at').notNull(),
});
```

Index on `messages.game_id` for the `GET /api/games/:id` join, and on
`games.user_id` for the future list endpoint (cheap to add now).

### Ownership-check helper (`apps/server/src/lib/ownership.ts`)

Single function used by `GET` and `DELETE` (and reused by every later
game-scoped endpoint):

```ts
async function loadOwnedGame(gameId: string, userId: string): Promise<Game> {
  const row = await db.query.games.findFirst({ where: eq(games.id, gameId) });
  if (!row || row.userId !== userId) throw new HttpError(404, 'Not found');
  return row;
}
```

Both "no such row" and "row belongs to someone else" collapse to the same
404 — SPEC.md §14 ("404 not 403 to avoid leaking existence").

### Route handlers (`apps/server/src/routes/games.ts`)

Registered under `/api/games` by the existing Fastify route plugin scaffold
from step 1. All three handlers run after the Better Auth session
preHandler from step 2; an unauthenticated request never reaches them.

- `POST /api/games`
  - Zod body: `{ prompt: z.string().min(1).max(2000) }`.
  - Generate `gameId = crypto.randomUUID()`, `messageId = crypto.randomUUID()`.
  - `now = Date.now()`.
  - `title = prompt.slice(0, 40)` (placeholder, per SPEC.md §7 — final title
    is set by step 4's parallel title-generation call).
  - Single transaction: insert `games` row + insert `messages` row
    (`kind='prompt'`, `content=prompt`).
  - Respond `201 { id, title, currentCode, originalPrompt, createdAt, updatedAt }`.
- `GET /api/games/:id`
  - `loadOwnedGame(id, session.user.id)`.
  - Fetch messages ordered by `created_at ASC`.
  - Respond `200 { ...game, messages: [...] }`.
- `DELETE /api/games/:id`
  - `loadOwnedGame(id, session.user.id)` (still 404s on mismatch).
  - `db.delete(games).where(eq(games.id, id))`. Cascade removes messages.
  - Respond `204`.

### Validation

Zod schemas live next to the handlers. The shared validation plugin from
step 1 (SPEC.md §14: "Zod schemas on all request bodies, validated by a
Fastify plugin") converts Zod failures to 400 with field-level errors.
Path params are simple strings — UUID-shape validation is not required for
ownership semantics (an unparseable id just returns 404 like any unknown id).

## Key decisions

### Why 404 on ownership mismatch, not 403

SPEC.md §14 is explicit: "404 (not 403) on mismatch to avoid leaking
existence." A 403 confirms the row exists and the requester just isn't the
owner; a 404 is indistinguishable from "no such id." Same reason GitHub
returns 404 on private repos to non-collaborators. Implementation cost is
zero — both branches in `loadOwnedGame` throw the same error.

### Why `messages` from day one despite only `prompt` kinds existing

Three reasons:

1. **Schema churn is more expensive than an unused column.** SPEC.md §5
   already specifies the table; deferring it to step 6 (refinement) means
   a second migration and rewriting the `POST /api/games` insert. Cheaper
   to land it now.
2. **`POST /api/games` is the natural place to write the first prompt
   row.** SPEC.md §7 shows the prompt persisted as a `messages` row at the
   top of the generation pipeline. Writing it during step 3 means step 4
   does not need to retrofit message persistence into its streaming path.
3. **`GET /api/games/:id` already needs to return messages** for the
   builder chat panel (SPEC.md §12). Step 4 stream completion does not
   produce a message row (assistant output is not persisted — SPEC.md §5
   note), so the message history is purely user-authored and exists from
   prompt-creation onward.

### Why `current_code` is empty string at row creation, not nullable

SPEC.md §5 declares `current_code text not null`. Step 4 will overwrite it
with the streamed HTML. Two viable defaults:

- Empty string `''` — preserves NOT NULL, signals "not yet generated."
- Minimal placeholder HTML — would render in the iframe as blank/broken.

Going with `''`. The row exists for ~milliseconds before step 4 starts
streaming HTML into it; for step 3 alone, `GET /api/games/:id` returning
`currentCode: ''` is correct (no game has been generated yet — only the
prompt has been recorded). No frontend work in this step depends on the
field being non-empty.

### Why no transaction wrapping `loadOwnedGame` + delete

DELETE is single-statement (`DELETE FROM games WHERE id = ?`); the
preceding ownership check is racy only against a concurrent delete from
the same user, which is benign (the second delete becomes a no-op affecting
zero rows — still 204 from our handler's perspective is acceptable, but we
return 404 if the load fails, so the loser of the race gets 404). Not
worth a transaction.

### Why `originalPrompt` is stored on `games` even though `messages` has the
same string

SPEC.md §5 specifies both. SPEC.md §7 uses `games.original_prompt` directly
in refinement context (§16) without joining messages. Denormalization is
deliberate — refinement is a hot path; message-table joins are not.

## Open questions

- **UUID source.** SPEC.md says "uuid" without specifying v4 vs v7. Going
  with `crypto.randomUUID()` (v4) for stdlib availability. v7 (time-sorted)
  would help the future list endpoint's pagination but is not on the
  critical path. Revisit in step 5 if list-endpoint sort becomes painful.
- **Prompt length cap.** SPEC.md does not specify. Picking 2000 chars as a
  Zod-level guard — long enough for any real game prompt, short enough to
  block obvious abuse. Confirm during step 4 when the actual model context
  window matters.
- **Should `DELETE` return the deleted row or 204?** SPEC.md §11 just says
  "hard delete." Going with 204 (no body) — standard REST. Frontend in
  step 5 doesn't need the body (it's already in the local cache being
  invalidated).

## Acceptance criteria

1. `bun run --cwd packages/db migrate` runs cleanly; `games` and `messages`
   tables exist with the columns and FKs from SPEC.md §5. Post-migrate
   `vec0` step still succeeds.
2. `POST /api/games` with a valid session and `{ prompt: "make pong" }`
   returns 201 with a row whose `originalPrompt === "make pong"`,
   `title === "make pong"` (≤40 chars), `currentCode === ""`, and
   `userId === session.user.id`. A `messages` row exists with
   `kind='prompt'` and `content='make pong'`.
3. `POST /api/games` with no session returns 401 (from step 2's auth
   middleware, not this step's code).
4. `POST /api/games` with `{ prompt: "" }` returns 400 with a Zod field
   error.
5. `GET /api/games/:id` as the owner returns the game plus its `messages`
   array ordered ascending by `createdAt`.
6. `GET /api/games/:id` as a different authenticated user returns 404,
   not 403, with no body that distinguishes "not yours" from "doesn't
   exist."
7. `GET /api/games/:nonexistent-uuid` returns 404 with the same shape.
8. `DELETE /api/games/:id` as the owner returns 204; the row and its
   messages are gone (verified by a follow-up `GET` returning 404).
9. `DELETE /api/games/:id` as a different user returns 404 and leaves the
   row intact.
10. No new dependencies on `ai`, `@ai-sdk/*`, or `sqlite-vec` are
    introduced in this step.
