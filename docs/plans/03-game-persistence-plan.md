# 03 — Game Persistence Foundation — Plan

Implements the design in `docs/designs/03-game-persistence.md`.

## Pre-flight

1. Confirm step 1 (monorepo scaffold) and step 2 (auth + user model) are
   merged. Specifically:
   - `packages/db/src/schema.ts` exists with the `users` table (extended by
     Better Auth) and the post-migrate `vec0` script.
   - `apps/server/src/plugins/auth.ts` registers the Better Auth session
     preHandler on `/api/*` (excluding `/api/auth/*` and `/api/health`).
   - `bun run dev` starts both apps; `GET /api/health` returns
     `{ ok: true, version }` cross-origin.
2. Confirm there is a Fastify route-registration plugin or convention from
   step 1 (e.g. `apps/server/src/routes/index.ts`) where new route files
   are wired up. If absent, this plan adds the wiring inline.
3. Confirm there is a Zod-validation Fastify plugin from step 1
   (SPEC.md §14). If absent, this plan adds Zod parsing inline in the
   handlers using `schema.parse(request.body)` and a shared error mapper.
4. Pull latest `main`. Branch: `feat/03-game-persistence`.

## Ordered tasks

### 1. Drizzle schema (`packages/db/src/schema.ts`)

- Append `games` table per SPEC.md §5 / design doc Architecture.
- Append `messages` table per SPEC.md §5 / design doc Architecture.
- Add indexes: `idx_messages_game_id` on `messages.game_id`,
  `idx_games_user_id` on `games.user_id`.
- Export both tables from `packages/db/src/index.ts` so the server can
  import them.

### 2. Generate migration

- Run `bun run --cwd packages/db generate` (or whatever drizzle-kit script
  step 1 added).
- Verify the generated SQL in `packages/db/src/migrations/` creates both
  tables, the FKs (`ON DELETE CASCADE` on both), and the indexes.
- Commit the migration file alongside the schema change.

### 3. Apply migration locally

- `bun run --cwd packages/db migrate` against the dev SQLite file.
- Confirm post-migrate `vec0` script still completes (no regression from
  step 1).

### 4. Ownership helper (`apps/server/src/lib/ownership.ts`)

- New file. Export `loadOwnedGame(gameId: string, userId: string)`.
- Use the shared Drizzle client from `@arcadeai/db`.
- On miss or user mismatch, throw a 404 `HttpError` (or whatever error
  shape the step 1 error plugin uses; if there is none, use Fastify's
  `reply.code(404).send({ error: 'Not found' })` directly from the
  handler instead of throwing — pick whichever matches existing convention).

### 5. Route handlers (`apps/server/src/routes/games.ts`)

- New file. Export a Fastify plugin that registers three routes under
  `/api/games`.
- Define Zod schemas at the top of the file:
  - `CreateGameBody = z.object({ prompt: z.string().min(1).max(2000) })`
  - `GameIdParams   = z.object({ id: z.string().min(1) })`
- `POST /api/games` handler:
  - Read `session.user.id` from the request (set by step 2's auth plugin).
  - Parse body with `CreateGameBody`.
  - `id = crypto.randomUUID()`; `now = Date.now()`;
    `title = prompt.slice(0, 40)`.
  - In a single `db.transaction(async (tx) => { ... })`:
    - Insert `games` row with `currentCode: ''`, `thumbnail: null`,
      `genre: null`, `originalPrompt: prompt`, timestamps `now`.
    - Insert `messages` row with `kind: 'prompt'`, `content: prompt`.
  - Reply 201 with the inserted game row (no messages array on create).
- `GET /api/games/:id` handler:
  - Parse params with `GameIdParams`.
  - `game = await loadOwnedGame(id, session.user.id)`.
  - `msgs = await db.select().from(messages).where(eq(messages.gameId, id))
            .orderBy(asc(messages.createdAt))`.
  - Reply 200 with `{ ...game, messages: msgs }`.
- `DELETE /api/games/:id` handler:
  - Parse params with `GameIdParams`.
  - `await loadOwnedGame(id, session.user.id)` (404s on miss/mismatch).
  - `await db.delete(games).where(eq(games.id, id))`. Cascade clears
    messages.
  - Reply 204 with no body.

### 6. Wire the plugin

- Register `routes/games.ts` in whatever root route registration the
  server uses (`app.register(gamesRoutes, { prefix: '/api/games' })` or
  equivalent). Confirm it sits behind the auth preHandler.

### 7. Manual smoke (see Verification).

### 8. Format + lint

- `bun run check` (Biome — lint + format together, per SPEC.md §4).
- Fix any reported issues.

### 9. Commit

- One commit, scope `feat`, e.g.
  `feat(server): game persistence schema and CRUD endpoints`.
- Per AGENTS.md: do not auto-author the commit message — surface the diff
  for the developer to commit.

## Verification

All commands assume the dev server is running (`bun run dev`) and the
developer has signed in once via Google or GitHub so a session cookie
exists in the cookie jar at `/tmp/arcadeai-cookies.txt`. Replace
placeholders as needed.

### Auth gating (must 401 unauth, succeed authed)

```bash
# unauth
curl -i -X POST http://localhost:3000/api/games \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"make pong"}'
# expect: HTTP/1.1 401

# authed
curl -i -X POST http://localhost:3000/api/games \
  -b /tmp/arcadeai-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"make pong"}'
# expect: HTTP/1.1 201, body has id, title="make pong", currentCode="",
#         originalPrompt="make pong"
```

Capture the returned id:

```bash
GAME_ID=$(curl -s -X POST http://localhost:3000/api/games \
  -b /tmp/arcadeai-cookies.txt -H 'Content-Type: application/json' \
  -d '{"prompt":"make snake"}' | jq -r .id)
```

### Validation (must 400 on empty prompt)

```bash
curl -i -X POST http://localhost:3000/api/games \
  -b /tmp/arcadeai-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"prompt":""}'
# expect: HTTP/1.1 400 with field-level error mentioning "prompt"
```

### GET as owner (must 200 with messages)

```bash
curl -s http://localhost:3000/api/games/$GAME_ID \
  -b /tmp/arcadeai-cookies.txt | jq
# expect: {
#   id, userId, title: "make snake", currentCode: "",
#   originalPrompt: "make snake", thumbnail: null, genre: null,
#   createdAt, updatedAt,
#   messages: [{ id, gameId, kind: "prompt", content: "make snake", createdAt }]
# }
```

### Ownership 404 (must 404, not 403)

Sign in as a second user (different OAuth account) into a second cookie
jar `/tmp/arcadeai-cookies-b.txt`, then:

```bash
curl -i http://localhost:3000/api/games/$GAME_ID \
  -b /tmp/arcadeai-cookies-b.txt
# expect: HTTP/1.1 404 (not 403)
# response body must not distinguish "not yours" from "doesn't exist"
```

### GET nonexistent id (must 404, identical shape)

```bash
curl -i http://localhost:3000/api/games/00000000-0000-0000-0000-000000000000 \
  -b /tmp/arcadeai-cookies.txt
# expect: HTTP/1.1 404 with the same body shape as the previous test
```

### DELETE non-owner (must 404, row survives)

```bash
curl -i -X DELETE http://localhost:3000/api/games/$GAME_ID \
  -b /tmp/arcadeai-cookies-b.txt
# expect: HTTP/1.1 404

# confirm row still exists
curl -i http://localhost:3000/api/games/$GAME_ID -b /tmp/arcadeai-cookies.txt
# expect: HTTP/1.1 200
```

### DELETE as owner (must 204, cascade removes messages)

```bash
curl -i -X DELETE http://localhost:3000/api/games/$GAME_ID \
  -b /tmp/arcadeai-cookies.txt
# expect: HTTP/1.1 204

curl -i http://localhost:3000/api/games/$GAME_ID -b /tmp/arcadeai-cookies.txt
# expect: HTTP/1.1 404
```

### Schema sanity (sqlite CLI)

```bash
sqlite3 apps/server/data/arcadeai.db '.schema games'
sqlite3 apps/server/data/arcadeai.db '.schema messages'
# both must match SPEC.md §5: column names, types, NOT NULL flags,
# FK with ON DELETE CASCADE, indexes on game_id / user_id.
```

### Build + typecheck

```bash
bun run build      # SPEC.md §4 — apps/server typechecks via tsc --noEmit
bun run check      # Biome lint + format
```

Both must pass with zero errors before commit (AGENTS.md pre-commit gate).

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — End of plan

After all tasks complete and the pre-commit gate passes:

```
feat(games): add games + messages tables and crud foundation
```

Includes: `games` and `messages` schema additions in `packages/db`, the generated migration, `apps/server/src/lib/ownership.ts`, and the `apps/server/src/routes/games.ts` CRUD handlers.

## Rollback notes

- This step adds a single Drizzle migration and three new files. Reverting
  is mechanical:
  1. `git revert <commit>` removes the schema change, the migration file,
     `apps/server/src/routes/games.ts`, and `apps/server/src/lib/ownership.ts`.
  2. To roll the dev DB back: delete `apps/server/data/arcadeai.db` and
     re-run `bun run --cwd packages/db migrate` (acceptable because no
     real user data exists yet — this is a local prototype, SPEC.md §1).
- No public API contract has shipped yet, so no consumers depend on these
  endpoints. Step 4 builds directly on this step; if step 3 is reverted,
  step 4 must be reverted with it.
- The `users` table from step 2 and the post-migrate `vec0` step from
  step 1 are untouched — this step adds tables, never alters existing ones.
