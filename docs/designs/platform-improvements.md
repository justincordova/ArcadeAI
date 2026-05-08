# Platform Improvements

## Context

Following a comprehensive code review, this design captures **95 accepted improvements** across product, RAG, UX, design system, auth, credits, backend architecture, frontend architecture, observability, DX, security, analytics, and documentation — plus a **temporary free-tier limit change** for the initial deployment.

Two recommendations are explicitly rejected:
- **Multiplayer / leaderboards** — complexity not worth it for MVP
- **Email/password auth** — keep Google + GitHub only; avoids email-sending infrastructure

Everything else is in scope. Work is grouped into milestones the developer can ship incrementally rather than as one monolithic refactor.

This is a working prototype heading to its first deployment for testing. The temporary free-tier limits (§1) apply ONLY to this initial deployment phase and revert via a single feature-flag flip before public launch.

---

## Goals

- Deploy a public build ready for first-user testing with deliberate free-tier throttling
- Convert the strongest growth lever (public sharing + remix) into a working flow
- Eliminate streaming hook duplication, replace inline styles with a real design system, and install the missing shadcn primitives the spec already required
- Reach meaningful unit test coverage on the most expensive-to-get-wrong code paths — written alongside the refactors, not after
- Close the observability gap so future regressions surface in logs, not user complaints
- Reconcile SPEC.md drift via sync-docs

## Non-Goals

- Multiplayer / leaderboards
- Email/password auth, email sending of any kind
- Production-grade scaling (Redis-backed concurrency lock, multi-instance) — noted as future work
- Stripe billing integration (already structured for it; not implementing)
- 3D, mobile-native, asset generation
- Test coverage of every file — focused on high-leverage, high-risk paths
- Admin dashboard, in-app feedback widget, PostHog analytics — deferred to a separate future-work design

---

## Design

### 1. Temporary Free-Tier Limits (Deployment Phase)

**Rationale:** During the initial public deployment, gate runaway costs from anonymous traffic while we observe real usage. Once we have data, the free tier reverts to SPEC §10 limits (3000/mo, 500/day) via a single config flip.

**Temporary policy (THIS DEPLOYMENT ONLY):**

| Tier | Lifetime Generations | Lifetime Refinements | Repairs |
|---|---|---|---|
| Free | **1 total, ever** | **3 total, ever** | Free (unlimited) |
| Creator / Pro / Admin | (unchanged from SPEC §10) | — | — |

Enforced via **lifetime counters**, not the existing daily/monthly windows. The daily/monthly columns continue to exist and decrement (for observability), but the actual gate is the new lifetime counters.

**Schema additions** (`packages/db/src/schema.ts`):

```ts
// users table — add two new columns
lifetimeGenerationsUsed: integer("lifetime_generations_used").notNull().default(0),
lifetimeRefinementsUsed: integer("lifetime_refinements_used").notNull().default(0),
```

A new migration adds these columns with `DEFAULT 0`. Existing users start at 0 (they get a fresh trial on the new build — intentional).

**Configuration** (`packages/shared/src/plans.ts`):

```ts
export const FREE_TIER_LIFETIME_LIMITS = {
  generations: 1,
  refinements: 3,
} as const;

// Flip to false to revert to SPEC §10 standard limits
export const ENFORCE_LIFETIME_LIMITS_FOR_FREE = true;
```

**Enforcement** (`apps/server/src/services/usage/charge.ts:deduct()`):

The atomic conditional UPDATE that decrements credits is extended to also check + increment the matching lifetime counter when `tier === 'free'` and the flag is on:

```sql
UPDATE "user"
   SET credits_remaining_daily   = credits_remaining_daily   - ?,
       credits_remaining_monthly = credits_remaining_monthly - ?,
       lifetime_generations_used = lifetime_generations_used + ?,  -- 1 for gen, 0 otherwise
       lifetime_refinements_used = lifetime_refinements_used + ?   -- 1 for refine, 0 otherwise
 WHERE id = ?
   AND credits_remaining_monthly >= ?
   [AND credits_remaining_daily >= ?]
   [AND lifetime_generations_used < ?]    -- only when free + flag on + action=generation
   [AND lifetime_refinements_used < ?]    -- only when free + flag on + action=refinement
```

If `changes === 0`, distinguish *which* guard failed by re-reading the user row and throwing the correct error. The error type uses `resetAt: 0` to signal "no reset, hard cap" so the client renders an upgrade CTA instead of a reset countdown.

**Refund behavior:** `refund()` decrements the lifetime counter back along with the credit refund. User cancel does NOT decrement (matches existing credit behavior).

**Client UX:**
- `PlanBadge` dropdown for Free users (when flag on): show "**Generations: 0/1** • Refinements: 1/3" instead of daily/monthly bars
- Builder banner on exhaustion: "You've used your free trial. [Upgrade →]"
- `MeResponse` exposes `lifetimeGenerationsUsed` and `lifetimeRefinementsUsed`

**Reverting:**
Set `ENFORCE_LIFETIME_LIMITS_FOR_FREE = false` and redeploy. Columns stay in the DB. No data migration.

---

### 2. Milestone A — Free-Tier Limits + Deployment Hardening

The smallest, highest-priority milestone. Must ship before any public deployment.

**Tasks:**

1. **Migration:** add `lifetime_generations_used`, `lifetime_refinements_used` columns
2. **`packages/shared/src/plans.ts`:** `FREE_TIER_LIFETIME_LIMITS` + `ENFORCE_LIFETIME_LIMITS_FOR_FREE` flag
3. **`charge.ts`:** extend atomic deduct + refund for lifetime counters, with new error path for hard-cap exhaustion
4. **`MeResponse` + `GET /api/me`:** include the two new lifetime counters
5. **`PlanBadge.tsx`:** Free-tier rendering switches to lifetime view when flag is on
6. **Builder exhaustion banner:** detect 402 with `resetAt === 0` → upgrade CTA instead of reset copy
7. **#48 — Active streams reset on startup:** `lib/active-streams.ts` exports `clear()`; called from `index.ts` on boot
8. **#49 — SSE heartbeat:** `lib/sse.ts` adds `startHeartbeat(reply)` writing `:keep-alive\n\n` every 15s; all three streaming routes call it
9. **#50 — Server-side LLM timeout:** `services/llm/client.ts` composes a 90s timeout (60s for repair) AbortController with the user's signal
10. **#52 — Graceful shutdown:** `index.ts` handles `SIGINT`/`SIGTERM` → `app.close()` + `clear()`
11. **#79 — Validate env vars at startup:** new `lib/env.ts` with Zod parses `process.env`; fails fast with a friendly error

**Tests written alongside this milestone:**
- `charge.ts:deduct` — TOCTOU correctness (2 concurrent calls, only 1 succeeds)
- `charge.ts:deduct` — lifetime-cap enforcement on free tier
- `charge.ts:refund` — idempotency + lifetime counter rollback
- `lib/active-streams.ts` — acquire / release / clear semantics
- `lib/sse.ts` — origin validation + heartbeat helper

**Ship checklist** (must all be true before deployment):

- [ ] `bun run build && bun run lint && bun run test` all pass
- [ ] Migration tested on a copy of dev DB
- [ ] `ENFORCE_LIFETIME_LIMITS_FOR_FREE = true` confirmed in deployed config
- [ ] Manually verified: new free user can do exactly 1 generation, then sees upgrade banner
- [ ] Manually verified: new free user can do exactly 3 refinements after first generation, then sees upgrade banner
- [ ] Manually verified: server SIGTERM finishes in-flight streams cleanly within 30s
- [ ] Production env vars set: `BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `WEB_ORIGIN`, `DATABASE_PATH`, `ADMIN_EMAILS`, OAuth credentials
- [ ] DB backed up (even if just a `cp` of the SQLite file)

---

### 3. Milestone B — Public Sharing + Remix

Implements **#1** and **#2** from the brainstorm — the strongest growth lever.

**Schema additions:**

```ts
// games table — add publish flag and slug
isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
publicSlug: text("public_slug").unique(),   // null until published
publishedAt: integer("published_at"),
remixedFromGameId: text("remixed_from_game_id")
  .references(() => games.id, { onDelete: "set null" }),
```

Migration adds the columns plus a partial unique index on `public_slug WHERE public_slug IS NOT NULL`.

**New endpoints:**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/games/:id/publish` | required (owner) | Set `isPublic=true`, generate `public_slug` (8 hex chars, retry on collision), return `{ slug, url }` |
| `POST` | `/api/games/:id/unpublish` | required (owner) | Set `isPublic=false`. Slug retained so re-publishing keeps the same URL. |
| `GET` | `/api/play/:slug` | **public** | Returns `{ id, title, currentCode, originalPrompt, ownerDisplayName }`. No messages, no auth-leaking fields. |
| `POST` | `/api/play/:slug/remix` | required (any user) | Creates a new owned game by copying `current_code`, `original_prompt`, `genre`, sets `remixedFromGameId`. Charges 0 credits but counts 1 against lifetime generations. |

**New client routes:**

| Route | Auth | Purpose |
|---|---|---|
| `/play/:slug` | optional | Read-only public game player. Iframe + footer with title, original prompt, "Made by {displayName}", and a prominent "Remix this" button. Unauthenticated visitors are routed through `/sign-in?next=/play/:slug?intent=remix`. |

A `/discover` gallery is **not** in this milestone. Defer until there are enough public games to populate it.

**Client UX:**
- "Share" button on the builder header: toggles publish state, copies URL on success with a toast
- `GameCard` shows a small "Public" badge when `isPublic === true`
- Remix flow: post-sign-in redirect with `?intent=remix` triggers an immediate `POST /remix` and navigates to the new game

**Lifetime-limit interaction:**
Remixes count against the free user's lifetime generation cap so a Remix-of-remix loop can't bypass it. Document this rule visibly on the remix button tooltip when the user is exhausted.

**Security:**
- `loadPublicGame(slug)` is the ONLY non-owner read path; selects only public-safe fields
- iframe sandbox unchanged (`allow-scripts` only)
- 404 (not 403) on private/unknown slug to avoid existence leakage
- Settings page: small warning before publishing if `displayName` looks like a real name (first letter uppercase + space — soft heuristic, no PII detection promised)

**Tests written alongside this milestone:**
- `loadPublicGame` returns null for private/missing/wrong slug
- `POST /api/play/:slug/remix` charges 1 lifetime generation for free user (integration)
- `POST /api/play/:slug/remix` returns 402 when free user exhausted
- `/api/play/:slug` does not leak `userId`, `messages`, or refund history

---

### 4. Milestone C — Design System Consolidation

Addresses **#25, #26, #27, #28, #29, #30** plus the file-split items **#62, #63, #64**.

**Install:**
- `shadcn/ui` primitives: `button card dialog dropdown-menu input label separator skeleton sonner switch tabs tooltip avatar`
- `lucide-react` (replaces all inline SVGs)
- `class-variance-authority` (auto-installed by shadcn)

**Refactor approach:** per-component migration. NEW UI uses Tailwind + shadcn from day one. Existing inline-style components migrate in this order:

1. `MessageBubble` (cleanest extraction)
2. Split `Builder.tsx` (741 lines) into:
   - `Builder.tsx` (entry/dispatch — ~30 lines)
   - `GenerationBuilder.tsx`
   - `RefinementBuilder.tsx`
   - `BuilderLayout.tsx`
   - `MessageBubble.tsx`
   - `StreamingIndicator.tsx`
   - `SuggestionChips.tsx`
   - `SendButton.tsx`
3. Split `GameCard.tsx` (635 lines) into:
   - `GameCardGrid.tsx` + `GameCardList.tsx`
   - `useGameCardActions.ts`
   - `DeleteGameDialog.tsx` (using shadcn `Dialog`)
4. Split `PlanBadge.tsx` (293 lines): button + state + dropdown panel
5. `RepairFallbackDialog` → shadcn `Dialog`
6. Settings page sections → shadcn primitives

**Light mode (#29):** the toggle currently does nothing visible — broken UI is worse than no UI.
- Add a `.light` block in `index.css` that overrides every `--color-*` variable
- Verify every screen with the toggle; **acceptance criterion:** every page in light mode has readable contrast and no neon-on-cream eye-burns

**Toasts (#27):**
- Add `<Toaster />` to `_authed.tsx` layout
- Wire success/error toasts to: rename, delete, theme save, share, remix, account delete
- Replace silent `console.warn` calls with toasts

**Icons (#28):**
- Replace every inline SVG with a lucide-react icon
- Delete duplicated per-file SVG components

**Animations (#30):**
- Move `pulse-dot`, `spin`, `route-fade-in` keyframes into `index.css`
- Remove inline `<style>` tags from components

**Tests:** none — frontend-only milestone, no backend tests required.

---

### 5. Milestone D — Streaming Hook + Frontend Architecture

Addresses **#61** (the strongest case for shared state — three near-identical streaming hooks), **#67** (defaultQueryFn footgun), **#66** (hooks vs lib convention), **#68** (theme provider split), **#69** (`@/` path alias), **#70** (error boundaries), **#35** (`fetchMe` rename).

**Shared SSE hook** — `hooks/useSSEStream.ts`:

```ts
interface SSEStreamHandlers<TMeta = unknown> {
  onMeta?: (data: TMeta) => void;
  onChunk?: (delta: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export function useSSEStream<TMeta = unknown>(opts: {
  url: string;
  body?: unknown;
  handlers: SSEStreamHandlers<TMeta>;
}): {
  status: "idle" | "streaming" | "error";
  error: string | null;
  start: () => void;
  stop: () => void;
};
```

The three existing hooks become thin wrappers (~30 lines each). Common logic extracted:
- SSE frame parsing (with `:keep-alive` heartbeat awareness from Milestone A)
- AbortController setup + cleanup
- 409/402/422 status handling
- "stream ended without terminator" detection

**defaultQueryFn cleanup (#67):**
- Remove the dispatch-by-key default from `lib/query-client.ts`
- `useSession` passes `queryFn: fetchMe` explicitly

**Hooks/lib convention (#66) + fetchMe rename (#35):**
- `hooks/` = React hooks ONLY
- `lib/api/*` = fetch wrappers (no React)
- `lib/auth.ts` → split into `lib/api/auth.ts` (fetch wrappers) + `hooks/useAuth.ts` if needed
- Rename `lib/auth.ts:fetchMe` → `lib/api/auth.ts:fetchMeOrNull`. The two-fetchMe gotcha goes away.

**Path alias (#69):**
- Add `"@/*": ["./src/*"]` to `apps/web/tsconfig.json`
- Update vite-tsconfig-paths config
- Codemod replaces deep relative imports with `@/`

**Theme provider split (#68):**
- Extract cross-tab + system listener into `hooks/useThemeSync.ts`
- `theme-provider.tsx` becomes thin wrapper

**Error boundaries (#70):**
- Hand-rolled ~30-line `ErrorBoundary` class component (the `react-error-boundary` package's class types fight this repo's React 19 `@types/react`; not worth the dep)
- Wrap the root layout in an ErrorBoundary keyed on pathname so route changes auto-reset
- `RouteError` shows generic "Something went wrong" + reload button + (in dev) error message

**Tests:** none — frontend-only milestone, no backend tests required.

---

### 6. Milestone E — Backend Architecture + RAG

Addresses **#51** (DB singleton), **#54/55/59** (enum constraints), **#56** (error response shape), **#57** (oversized games.ts), **#60** (real tokenizer), plus RAG strategy items **#7-11**.

**Error response shape (#56):**

`lib/errors.ts`:

```ts
export type ApiError = {
  code: string;          // "INSUFFICIENT_CREDITS", "VALIDATION_ERROR", "FREE_TIER_EXHAUSTED", ...
  message: string;
  details?: Record<string, unknown>;
};

export function sendError(reply: FastifyReply, status: number, error: ApiError): FastifyReply;
```

All routes migrate. The frontend switches on `code` instead of parsing `message` strings. **Migration is per-route to keep diffs reviewable** — server route + matching client error handler in the same commit.

**games.ts split (#57): deferred.**

Original plan was to extract the 770-line `routes/games.ts` into `services/generation/run-{generation,refinement,repair}.ts` async generators. The stated motivation was testability. Reassessing: Fastify routes are testable via `app.inject()` regardless of internal structure, so the generator extraction adds significant rewrite risk for marginal testing benefit when there are no tests yet to backstop the refactor. Revisit once Milestone I has integration tests in place — then the split (or a different decomposition that the tests prove correct) can be done with a safety net.

**Enum constraints (#54, #55, #59):**
- `tier`, `genre`, `theme`, `messages.kind`, `usageLog.action` get Drizzle enum types so the TS layer catches typos at compile time
- DB-level CHECK constraints **deferred**: SQLite doesn't support `ALTER TABLE ADD CONSTRAINT`, so the CHECK migration would require recreating each table — risky on a live DB for marginal value (Zod schemas at the route layer already enforce the same invariant). Revisit alongside any future schema-rebuild migration.

**DB client (#51):**
- `lib/db.ts` exports `createDb(path)` factory
- `index.ts` calls it once on boot
- Services receive the DB via injection (not import-time singleton)
- Enables `:memory:` test setup

**Tokenizer (#60):**
- Install `@anthropic-ai/tokenizer`
- `services/refinement/context.ts` uses real token counting; threshold remains 2000

**RAG improvements:**

- **#8 — Retrieval logging (shipped):** `services/rag/retrieve.ts` logs `{ ragExampleId, similarity, genreFilter, fellBackToGlobal }` on every retrieval. This is the foundational data every other RAG decision needs.
- **#7, #9, #10, #11 — deferred:** the multi-example flag, prompt summarization before embedding, the `rag_quality_signals` table, and style-tag retrieval all benefit from the #8 logs as their evaluation baseline. Ship them after a few hundred generations have accumulated retrieval logs so the impact can actually be measured rather than guessed at.

**Tests written alongside this milestone:**
- `services/usage/reset.ts:applyResets` — writes only when changed; admin tier handling
- `services/refinement/context.ts` — summarization threshold; output format
- `services/rag/retrieve.ts` — happy path + global fallback + DB error + missing embedding
- `services/llm/classify.ts` (with mocked LLM) — happy + failure → defaults to `other`
- `routes/games.ts POST` integration:
  - 400 on empty prompt
  - 402 when out of credits
  - 409 when stream already active
  - Game row + first message persisted before SSE meta event
  - Refund on LLM error
- `routes/games.ts POST /:id/refine` integration:
  - 400 if game has no current code
  - **Partial code persisted on user cancel** (regression test for the prior security fix)

---

### 7. Milestone F — UX, Streaming, Mobile

Addresses **#13** (streaming code preview), **#14** (skeletons), **#15** (prefetch), **#16** (mobile builder), **#17** (keyboard shortcuts), **#18** (code reveal), **#19** (richer empty state), **#21** (stop button placement), **#24** (adaptive suggestions), **#43** (reset countdown), **#44** (cost preview), **#45** (free tier explainer).

Items **#20** (chat bubbles refactor) and **#23** (game state persistence in iframe wrapper) are **dropped** from this milestone — the bubble alignment fix from a prior commit is sufficient, and #23 touches the system prompt, which means re-curating RAG examples for a cosmetic feature.

**Streaming code preview (#13):**
- Below `StreamingIndicator`, render a collapsible `<pre>` showing the last ~30 lines of streaming HTML, auto-scrolling
- Default collapsed; expand-on-click; state persisted to localStorage

**Loading skeletons (#14):**
- Dashboard: render N skeleton cards matching `view` mode while `isLoading`
- Game page: skeleton chat panel + iframe placeholder

**Prefetch on hover (#15):**
- `GameCard` `onMouseEnter`: `queryClient.prefetchQuery(["game", id], ...)`

**Mobile builder (#16):**
- At `< 768px`, switch to a tab toggle ("Chat / Game") showing one panel at a time
- **Acceptance criterion:** tested on real iPhone Safari at < 768px

**Keyboard shortcuts (#17):**
- Install `react-hotkeys-hook`
- `Cmd+K` / `Ctrl+K`: focus prompt input
- `Cmd+B`: toggle chat panel
- `Esc`: close any open dialog (uniformly)
- `?`: show shortcuts overlay

**Code reveal (#18):**
- After generation/refinement completes, message bubble has a "Show generated code" disclosure
- Render syntax-highlighted HTML with `shiki` (or `prism-react-renderer`)

**Empty state on `/game/new` (#19):**
- Replace the 3 hardcoded suggestions with genre cards (4-up grid) showing thumbnails of `rag_examples`
- Click → prefills the prompt with that genre name as a starter

**Stop button (#21):**
- During streaming, the chat-input send button BECOMES the stop button (red, square icon)
- Remove the floating overlay stop button entirely

**Adaptive suggestions (#24):**
- Move suggestion list to `packages/shared/src/suggestions.ts` (genre-categorized)
- Pick 3 randomly per page load, weighted toward genres the current user hasn't tried (when signed in)

**Cost preview (#44):**
- Below the prompt textarea: "Generate (200 credits) — you have 800"
- Free + flag-on: "Generate (1 of 1 remaining)"

**Free tier explainer (#45):**
- Tooltip on `PlanBadge` bars explains the daily/monthly relationship
- Lifetime mode tooltip: "Free trial: 1 game + 3 refinements"

**Reset countdown (#43):**
- Plan dropdown shows "Resets in 4h 23m" using a relative-time component that updates each minute

---

### 8. Milestone G — Auth, Credits, Billing Polish

Addresses **#34** (stale session), **#36** (account-linking half-done), **#37** (session invalidation), **#38** (CSRF), **#39** (sign-out cache), **#42** (refund reason granularity), **#46** (downgrade behavior).

Items **#40** (admin dashboard), **#41** (set-credits dev tool) **deferred** — these are dev/ops UX, not user-facing polish; defer to a separate future-work doc.

**Account linking (#36):**
- Implement disconnect with the SPEC §11 last-provider guard (was specced but never built)
- New `POST /api/auth/unlink/:provider` via Better Auth
- UI: "Disconnect" button per linked provider; disabled with tooltip on the last linked provider

**Session invalidation on delete (#37):**
- `DELETE /api/me` calls `auth.api.signOut(...)` server-side at the start of the handler

**CSRF defense-in-depth (#38):**
- Server middleware rejects non-`Content-Type: application/json` POST/PATCH/DELETE on `/api/*` (except `/api/auth/*` which Better Auth manages)
- `/api/games/:id/thumbnail` already uses JSON; verify
- Returns 415 Unsupported Media Type

**Sign-out cache clear (#39):**
- `lib/api/auth.ts:signOut` calls `queryClient.clear()` before hard navigation

**Stale session (#34):**
- Lower `useSession` `staleTime` from 60s to 15s
- Already-existing invalidation after streaming operations stays as-is

**Refund reasons (#42):**
- Audit every `refund(logId, { reason: 'llm_error' })` call
- Distinguish: `'timeout'`, `'abort'`, `'validation_error'`, `'persistence_error'`

**Downgrade behavior (#46):**
- `services/billing/change-plan.ts`: when new tier's monthly cap is LOWER than current `creditsRemainingMonthly`, do NOT cap. Keep the existing balance until the next monthly reset.
- Document the rule clearly in `plans.ts`

**Tests written alongside this milestone:**
- `routes/me.ts DELETE` — cascades; session invalidated; returns 204
- `routes/me.ts PATCH` — display_name + theme update
- `routes/billing.ts POST /change-plan` — happy path; admin-blocked; downgrade preserves balance

---

### 9. Milestone H — Observability, DX, Documentation

Addresses **#71** (log shipping docs), **#74** (RAG retrieval logging — covered in Milestone E), **#75** (userId in LLM cost logs), **#76-82** (DX), **#94** (sync-docs), **#97** (architecture diagram).

Items **#91-93** (PostHog analytics, conversion funnel, feedback widget) and **#95-96** (CHANGELOG, CONTRIBUTING) **deferred** to a future-work doc; not deploy-blocking.

**Observability:**
- **#75:** Verify `logUsageOnDrain` in `client.ts` uses the request's child logger (which has `userId` bound). Plumb explicitly if not.
- **#71:** `docs/operations.md` documenting log-shipping options (Loki / Datadog / CloudWatch) — not implementing, just noting.

**DX:**
- **#76:** `bun run typecheck` runs `tsc --noEmit` across all workspaces (faster than full build)
- **#77:** Install `lefthook`; pre-commit runs `bun run build && bun run lint && bun run test`
- **#78:** `.github/workflows/ci.yml` runs build + lint + test on push and PR
- **#80:** Rewrite `README.md` (~150 lines): what, why, prereqs, env setup, dev/build/migrate, troubleshooting (`brew install sqlite`)
- **#81:** New `packages/db/src/seed.ts` — admin user + 3 sample games on `bun run --filter @arcadeai/db seed`
- **#82:** `bun run db:studio` runs `drizzle-kit studio`

**Docs:**
- **#94:** Run `sync-docs` to reconcile SPEC.md drift (sharing flow added, lifetime limits added, shadcn finally installed, etc.)
- **#97:** Mermaid sequence diagram in README showing user → vite → fastify → anthropic → SSE → iframe

---

### 10. Milestone I — Comprehensive Test Coverage Pass

The previous milestones each shipped tests **alongside** their refactors. This milestone is a deliberate sweep to fill gaps and lock in coverage before public launch.

**Setup (done in Milestone A, hardened here):**
- `vitest` + `@vitest/coverage-v8`
- Fastify's built-in `inject` API for backend route tests
- `bun run test`, `bun run test:watch`, `bun run test:coverage`
- CI: `bun run test` runs on every PR
- Frontend / component tests are explicitly out of scope.

**Test plan (gap-fill — items not already covered in earlier milestones):**

| Area | Test type |
|---|---|
| `services/usage/repair-log.ts` | unit |
| `lib/auth-helpers.ts` (`isAdminEmail`, time helpers) | unit |
| `lib/ownership.ts` — owner check, wrong-user 404 | unit |
| `services/llm/categorize-error.ts` (mocked) — happy + failure → defaults | unit |
| `services/llm/title.ts` (mocked) — clamped to ≤80 chars | unit |
| `services/llm/embed.ts` — error path; lazy client | unit |
| `routes/games.ts GET /:id` — owner + 404 on non-owner | integration |
| `routes/games.ts DELETE /:id` — owner only; cascades messages | integration |
| `routes/games.ts PATCH /:id` — title validation | integration |
| `routes/games.ts POST /:id/repair` — concurrency lock; 0-credit logging | integration |
| `routes/health.ts` — both endpoints | integration |
| `iframe-wrapper.ts` — wrapper injection at end of `</body>` | unit |

**Coverage targets** (soft, not gating):
- `services/` — high coverage on credit + RAG paths; routine getters can be lower
- `routes/` — every status code path exercised at least once per route

**Coverage is not the goal — confidence is.** A low-coverage file with an integration test that exercises the critical flow is more valuable than a high-coverage file padded with trivial assertions.

**CI integration:**
- `bun run test` must pass to merge
- Coverage report posted as a PR comment via the GitHub Action

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Free-tier limits during deployment | Lifetime: 1 generation + 3 refinements | Hard cap on per-user cost during initial public exposure; reverts via single config flip |
| Lifetime counters: schema vs flag | Two new columns, `*_used`, never decremented except on refund | Atomic increment combines with credit decrement in the same UPDATE — no second write, no race |
| Public game URLs | Random `public_slug` (8 hex chars), not the UUID | Doesn't leak game ID enumeration; user-shareable; collision-retry on insert |
| Remix charges | 0 credits but 1 lifetime generation | Prevents Remix-loop bypass of the cap; remix is a feature, not a free pass |
| shadcn install | Yes — install all primitives the SPEC originally required | Eliminates ~600 lines of hand-rolled UI code; matches SPEC's original intent |
| Tailwind vs inline | Tailwind for new code; per-file migration of existing | Don't pause feature work for a 3000-line refactor; let it happen incrementally |
| Streaming hook consolidation | Extract `useSSEStream` generic | Three near-identical hooks is a maintenance liability |
| Test framework | Vitest | Native ESM, fast, great Bun + React compat |
| When to write tests | Alongside the refactor that touches the code, plus a final gap-fill milestone | Tests against a moving target are wasted; tests written with the refactor catch real bugs |
| Light mode | Implement properly | Currently broken (toggle does nothing visible); shipping broken UI is worse than no UI |
| Idempotency keys | **Dropped** | Over-engineering for current scale; frontend concurrency lock + server 409 is sufficient |
| Game state persistence in iframe wrapper | **Dropped** | Touches system prompt → re-curation of RAG examples for cosmetic value; defer |
| Admin dashboard, analytics, feedback widget | **Deferred to future doc** | Not deploy-blocking; bigger than they look at first |

---

## Rejected Alternatives

- **Email/password auth (#33 from brainstorm)** — rejected per developer; avoids email-sending infrastructure
- **Multiplayer / leaderboards (#6 from brainstorm)** — rejected per developer; complexity not worth MVP
- **Big-bang refactor of all inline styles** — rejected; per-file migration order keeps feature work moving
- **Zustand for streaming state** — rejected during prior code review; shared `useSSEStream` hook is cleaner
- **Stripe billing this round** — out of scope; billing endpoint already structured for it
- **Production-grade infra (Redis, multi-instance)** — out of scope; documented as future work
- **`/discover` gallery in Milestone B** — defer until enough public games exist to fill it
- **Idempotency keys on `POST /api/games`** — over-engineering for current scale
- **Game state persistence (high scores) in iframe wrapper** — touches system prompt → cascades to RAG re-curation; deferred
- **Inline code editor (#22 from brainstorm)** — design space large enough to warrant its own future doc
- **Disconnect last linked OAuth provider** — keep SPEC's last-provider guard; just enforce it properly in Milestone G
- **Real-time multi-user dashboard sync** — out of scope; users only see their own data
- **Chat bubbles full refactor (#20)** — soft-rejected; the bubble alignment fix from a prior commit is sufficient
- **Admin dashboard + dev tooling (#40, #41)** — deferred to a future-work doc; not user-facing
- **PostHog analytics + feedback widget (#91-93)** — deferred to a future-work doc; not deploy-blocking

---

## Edge Cases & Constraints

- **Lifetime counter overflow:** SQLite `integer` is i64 — no realistic overflow concern
- **Migration on existing data:** new columns get `DEFAULT 0`; existing free users start fresh on the new build (intentional — they get to try the new features)
- **Public game slug collision:** 8 hex chars = 4B options; collision check on insert with retry, max 3 attempts then 500
- **Remix during exhaustion:** Free user who's used their 1 generation tries to remix → 402. The Remix button on `/play/:slug` should pre-check `/api/me` and disable with tooltip when exhausted.
- **Public games preserve owner identity:** `ownerDisplayName` exposed publicly. Settings page warns before publishing if display name looks like a real name (soft heuristic only — no PII detection guarantee).
- **iframe sandbox unchanged for public play:** same security posture; verified.
- **Mobile builder UX is a behavior change, not styling:** acceptance requires real-device testing.
- **`sqlite-vec` in tests:** unit tests for `services/rag/retrieve.ts` need the vec0 virtual table. Use a real test DB via `runPostMigrate` so the integration is honest, not stubbed.
- **Error response shape migration:** server route + matching client error handler in the SAME commit. Don't split.
- **CSRF middleware exempts thumbnail uploads:** existing thumbnail POST already sends `application/json`; verify no regression.
- **Heartbeat frame parser awareness:** SSE clients must skip lines starting with `:` (per spec); verify each `useSSEStream` consumer handles this.
- **Light-mode acceptance:** explicit walkthrough of every page (sign-in, dashboard, builder, settings, pricing, play, sign-up flows) before marking Milestone C done.

---

## Open Questions

None — all design decisions are resolved.

---

## Build Order

1. **Milestone A** — Free-tier limits + deployment hardening (deploy-blocking)
2. **Milestone B** — Public sharing + remix (deploy-blocking — strongest growth lever)
3. **Milestone C** — Design system consolidation
4. **Milestone D** — Streaming hook + frontend architecture
5. **Milestone E** — Backend architecture + RAG
6. **Milestone F** — UX, streaming preview, mobile
7. **Milestone G** — Auth, credits, billing polish
8. **Milestone H** — Observability, DX, documentation
9. **Milestone I** — Test coverage gap-fill

A and B must ship before deployment. C–H can ship post-launch in any order. **Tests are written alongside each milestone**, not deferred — Milestone I is a deliberate gap-fill before public launch.
