# ArcadeAI — Agent Context

Prompt-to-playable-game web app. User types a natural-language prompt; the server streams a single-file HTML5 canvas game into a sandboxed iframe via SSE. Users iterate through a chat loop, manage a game library, can publish to a public `/play/:slug` URL, and operate within a credit-based usage model.

Bun monorepo with two apps (`apps/server`, `apps/web`) and two packages (`packages/db`, `packages/shared`).

## Repo layout

```
apps/server     — Fastify API, Bun runtime, Better Auth, Drizzle ORM
apps/web        — React 19 SPA, Vite, TanStack Router + Query
packages/db     — SQLite schema (Drizzle), migrations, sqlite-vec extension
packages/shared — Types, constants, plan config shared across apps
docs/SPEC.md    — full product specification (the source of truth)
docs/operations.md — log shipping, backups, deployment, CI notes
docs/designs/   — in-flight design docs (merged into SPEC.md by sync-docs)
.github/workflows/ — CI (lint + build + test on push and PR)
```

## Commands

```bash
# Dev (runs all workspaces concurrently)
bun run dev

# Build (vite + tsc --noEmit)
bun run build

# Faster: typecheck only, no Vite step
bun run typecheck

# Tests (backend; bun:test)
bun run test

# Lint / format
bun run lint
bun run check        # lint + write fixes

# DB
bun run db:migrate     # apply pending migrations + post-migrate (sqlite-vec)
bun run db:generate    # drizzle-kit generate (after schema edits)
bun run db:studio      # open Drizzle Studio against the local DB
```

**Pre-commit gate:** `bun run build && bun run lint && bun run test` — all three must pass before committing.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Bun (server and scripts) |
| Server framework | Fastify v5 |
| Auth | Better Auth (Google + GitHub OAuth, account linking) |
| DB | SQLite via `bun:sqlite` + Drizzle ORM; `sqlite-vec` extension for RAG embeddings |
| LLM | Anthropic Claude (generation/refinement/repair) + OpenAI GPT-4.1-mini (classify/embed/title/repair-categorize) |
| AI SDK | Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) |
| Frontend state | TanStack Query (server state) + local React `useState` (UI state). No Zustand, no Redux. |
| Routing | TanStack Router (file-based, auto-generated route tree) |
| Styling | Tailwind v4 + inline styles (mixed — match whatever the file already uses) |

## Key architectural patterns

**SSE streaming with `reply.hijack()`**
All AI operations (generate, refine, repair) bypass Fastify serialization via `reply.hijack()` and write raw SSE frames using `lib/sse.ts`. The SSE response sets CORS headers manually — `writeSSEHeaders(reply, request)` validates the request `Origin` against `WEB_ORIGIN`. After hijacking, `@fastify/cors` no longer runs, so CORS must be handled explicitly in `sse.ts`.

**Credit deduction is atomic**
`services/usage/charge.ts:deduct()` uses a single conditional `UPDATE users WHERE credits >= cost` via the raw `sqlite` handle, then checks `sqlite.changes` to detect if the guard failed. Never split this into a read-then-write — that's a TOCTOU race.

**Auth guard is a root-scope `preHandler` hook**
`registerAuthGuard` must be called directly on the app instance (not inside a plugin), or it won't apply to routes registered in later plugins. Exempted paths: `/api/auth/*`, `/api/health`, `/api/config`, `/api/play/*` (the public play prefix; remix performs its own session check). If you add a new public endpoint, add it to the exemption list in `plugins/auth.ts`.

**Lazy credit reset (`applyResets`)**
Credits reset daily/monthly lazily — `services/usage/reset.ts:applyResets()` is called at the top of every route that touches credits. It reads timestamps, writes back only if something changed, and returns the current counters. Don't read `users.creditsRemainingDaily` directly without calling `applyResets` first.

**Optimistic refinement messages**
`RefinementBuilder` appends a local `kind: "feedback"` message immediately on submit. After the stream completes, `queryClient.invalidateQueries(["game", id])` replaces local state with server messages. If you add new message kinds, update `MessageBubble` in `Builder.tsx` — currently `prompt` and `feedback` both render on the user (right) side.

**Shared SSE hook**
`hooks/useSSEStream.ts` owns transport, abort lifecycle, frame parsing, `:keep-alive` skip, 402/409 status handling, and "stream ended without terminator" detection. The three streaming hooks (`useStreamedGeneration` / `useStreamedRefinement` / `useStreamedRepair`) are thin wrappers — supply a URL + handlers, get back `{ status, error, start, stop }`. Don't duplicate the parsing loop in a new hook; extend the shared one.

**`hooks/` vs `lib/api/*` split**
React hooks live in `apps/web/src/hooks/`. Plain fetch wrappers live in `apps/web/src/lib/api/*` (no React). Read paths that tolerate unauthenticated callers return `null` on 401 (`fetchMeOrNull`); mutations throw on error (`patchMe`, `deleteMe`, `unlinkProvider`). Don't put React hooks in `lib/`.

**`@/*` path alias**
`apps/web/tsconfig.json` maps `@/*` → `./src/*`. Anything two or more directory levels deep uses the alias. The TanStack-generated route tree is the only exception (it regenerates with relative paths).

**Standard `ApiError` response shape**
`apps/server/src/lib/errors.ts` exposes `sendError(reply, status, error)` and convenience constructors. Every `/api/*` error response is `{ code, message, details? }` where `code` is a closed enum (`VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`, `INSUFFICIENT_CREDITS`, `FREE_TIER_EXHAUSTED`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`). Frontend handlers switch on `code`, not `message`. New routes should use the helpers, not return ad-hoc shapes.

**CSRF Content-Type guard**
`plugins/csrf.ts` rejects `POST` / `PATCH` / `PUT` / `DELETE` on `/api/*` (excluding `/api/auth/*`) without `Content-Type: application/json`. Returns 415. New non-JSON endpoints (file uploads, etc.) must update the guard, not bypass it.

**Lifetime free-tier cap**
While `ENFORCE_LIFETIME_LIMITS_FOR_FREE` is true (`packages/shared/src/plans.ts`), free users have hard lifetime caps (1 generation, 3 refinements). The check is folded into the same atomic UPDATE as the credit deduct in `services/usage/charge.ts:deduct()`. The `usage_log.lifetime_counter_incremented` flag tells `refund` whether to roll the lifetime counter back, independent of the current tier or flag value.

## Known gotchas

**`sqlite-vec` requires Homebrew SQLite on macOS**
`packages/db/src/sqlite-vec-loader.ts` calls `Database.setCustomSQLite()` pointing at `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`. If it doesn't exist, the server crashes at startup. Install with `brew install sqlite`.

**Route tree is auto-generated — never edit it manually**
`apps/web/src/routeTree.gen.ts` is regenerated by the TanStack Router Vite plugin on every build. Edit route files under `apps/web/src/routes/` instead.

**`reply.hijack()` means no Fastify error handler**
Once a route calls `reply.hijack()` for SSE, the global `setErrorHandler` no longer runs for that request. All error handling inside the SSE block must be explicit — catch, write an `error` SSE event, call `endSSE(reply)`.

**`BETTER_AUTH_SECRET` missing in production fails at startup**
`lib/auth.ts` throws on import if `NODE_ENV === "production"` and `BETTER_AUTH_SECRET` is unset. The server will not start.

**Concurrency lock is in-memory**
`lib/active-streams.ts` uses a `Set<string>` — not persisted, not shared across processes. A multi-instance deployment would need a Redis-backed lock. Server restart clears it.

## Further reading

- **`docs/SPEC.md`** — full product specification, feature scope, credit system rules
- **`docs/designs/`** — in-flight design docs for features not yet in SPEC.md
- **`packages/shared/src/plans.ts`** — tier credit limits and plan config
- **`packages/db/src/schema.ts`** — full DB schema
