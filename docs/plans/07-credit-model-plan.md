# 07 — Credit Model + Usage Tracking — Implementation Plan

Implements the design in `docs/designs/07-credit-model.md`. Grounded in SPEC §5, §10, §11, §12, §14.

## Pre-flight

Confirm the following before starting:

- Step 2 complete: Better Auth wired with `databaseHooks.user.create.before` setting `tier`, initial `credits_remaining_*`, and `*_reset_at` on first sign-in. `GET /api/me` exists and returns the session user.
- Step 4 complete: `POST /api/games` runs the Sonnet pipeline with SSE streaming, `meta`/`chunk`/`done` events, AbortController cancellation, 1-concurrent-generation cap.
- Step 6 complete: `POST /api/games/:id/refine` with the refinement context strategy from SPEC §16.
- `packages/shared/src/plans.ts` exists (or is created here) and is importable from both apps.
- Drizzle migration tooling working; `bun run db:migrate` is the command.

If any of these are missing, stop and resolve before continuing.

## Ordered tasks

### 1. Schema: `usage_log` table

- Add the `usage_log` table to `packages/db/src/schema.ts` matching SPEC §5 verbatim — this includes `refunded_at INTEGER` (nullable) per SPEC §5 / §10. Set once on refund; idempotency is enforced by the `refunded_at IS NULL` check at the SQL layer.
- Add an index on `(user_id, created_at)`.
- Generate a single Drizzle migration that creates the table with all SPEC §5 columns (no follow-up migration for `refunded_at` — it ships in the initial table definition).
- Apply the migration. Verify the table exists by running a single `SELECT id, refunded_at FROM usage_log LIMIT 0` from a quick script or via `sqlite3`.

### 2. Cost constants (consume canonical tier limits from step 02)

- In `packages/shared/src/plans.ts`, **add** a new export:
  - `CREDIT_COSTS = { generation: 200, refinement: 150, repair: 0 } as const`
- Do NOT redeclare tier allotments. Step 02 owns the canonical `TIER_CREDIT_LIMITS` export (`{ monthly, daily, dailyEnforced }` per tier). Step 07 imports and consumes it as-is.
- `CREDIT_COSTS` is per-action cost — a different concept from per-tier limits — so it lives alongside `TIER_CREDIT_LIMITS` without overlap.
- Re-export both from `packages/shared/src/index.ts` so server and web share one source.

### 3. Lazy-reset utility

- Create `apps/server/src/services/usage/reset.ts` exporting `applyResets(userId)`.
- Implement next-UTC-midnight and first-of-next-month-UTC computations as small pure helpers (`nextUtcMidnight(now)`, `nextUtcMonthStart(now)`); unit-testable later.
- In one transaction: read `tier`, `daily_reset_at`, `monthly_reset_at`; if either is `<= now`, reset the relevant counter from `TIER_CREDIT_LIMITS[tier]` (canonical export from step 02) and advance the timestamp.
- Skip counter resets for Admin but still advance timestamps.
- Return the post-reset row.

### 4. Charge service

- Create `apps/server/src/services/usage/charge.ts` exporting:
  - `class InsufficientCreditsError extends Error { resetAt: number }`
  - `async function deduct(userId, action: 'generation' | 'refinement', gameId: string | null): Promise<{ logId: string }>`
  - `async function markSucceeded(logId)`
  - `async function refund(logId)`
- `deduct` flow: `applyResets` → branch on tier per SPEC §10:
  - Admin: insert log row with `credits_charged=0, succeeded=0, refunded_at=null`, return `logId`.
  - Free (`dailyEnforced: true`): ensure both `credits_remaining_daily` and `credits_remaining_monthly` >= cost; decrement both; insert log row with `succeeded=0, refunded_at=null`.
  - Creator/Pro (`dailyEnforced: false`): ensure `credits_remaining_monthly` >= cost; skip the daily check; decrement both counters for observability; insert log row.
- On insufficient credits, throw `InsufficientCreditsError` with the relevant `*_reset_at`.
- `refund`: per SPEC §10 step 4 — only proceeds if `refunded_at IS NULL` (idempotency guard at the SQL layer). Increments both counters back by the original `credits_charged` and sets `refunded_at = now`. Leaves `succeeded=0`. A second call is a no-op.
- `markSucceeded`: set `succeeded=1`. Idempotent (no-op if already 1). Does NOT touch `refunded_at`.

### 5. Refund idempotency (resolved by SPEC §5 / §10)

- No follow-up migration needed — `refunded_at INTEGER` ships in the initial `usage_log` table per SPEC §5 (see task 1).
- Idempotency is enforced inside `refund` via a single SQL update guarded on `refunded_at IS NULL` (per SPEC §10 step 4). Verify via test: calling `refund(logId)` twice in a row leaves the row's `refunded_at` set to the first call's timestamp and counter values unchanged after the second call.

### 6. Paid-tier daily semantics (per SPEC §10 "Daily counter for paid tiers")

SPEC §10 is explicit: only Free has an enforced daily cap. Creator/Pro/Admin have no daily cap — the daily counter is decremented for observability but the daily check is skipped.

- For Free (`TIER_CREDIT_LIMITS.free.dailyEnforced === true`): gate on both daily and monthly counters; decrement both.
- For Creator/Pro (`dailyEnforced === false`): skip the daily check; decrement daily by the cost too (so the dropdown bar still reflects activity, mapped against the same monthly allotment).
- For Admin: no decrement, no check; still write a `usage_log` row with `credits_charged=0` for observability (per design "Admin bypass at the deduct layer").
- Document the SPEC §10 citation inline at the top of `charge.ts`.

### 7. Extend `GET /api/me`

- Call `applyResets(userId)` at the start of the handler.
- Return: `{ id, email, displayName, tier, theme, creditsRemainingDaily, creditsRemainingMonthly, dailyResetAt, monthlyResetAt, providers }` (providers list already there from step 2).
- Update the shared response type in `packages/shared/src/types.ts`.

### 8. Integrate deduction in `POST /api/games`

Row creation MUST come before `deduct` because SPEC §11 specifies that the `meta` SSE event is sent immediately after game row creation and `usage_log.game_id` references the row's id. The 402 check therefore happens BEFORE row creation by an upfront `applyResets` + counter read on the user — no row is created if credits are insufficient.

Explicit sequence (single-shot generation, `POST /api/games`):

a. `applyResets(userId)` — lazy reset.
b. Counter check vs `CREDIT_COSTS.generation`. For Free: check both daily and monthly remaining. For Creator/Pro: check only monthly. For Admin: skip. If insufficient, return **402 `{ error: 'insufficient_credits', resetAt }` BEFORE creating the game row** — no DB writes occur in this branch, no SSE bytes are emitted.
c. Create `games` row + `messages` row (`kind='prompt'`) in one transaction.
d. `deduct(userId, gameId, action='generation')` — writes the `usage_log` row with `succeeded=0, refunded_at=null` and the just-created `gameId`. Counters are decremented inside this call (admin: zero-cost log row only).
e. Emit SSE `meta` event with `{ gameId, placeholderTitle }`.
f. Stream Sonnet output (`chunk` events).
g. Finalize:
   - On normal completion: `markSucceeded(logId)`, emit `done`.
   - On unrecoverable server error during streaming: `refund(logId)` (idempotent on `refunded_at IS NULL` per SPEC §10), emit SSE `error`, close stream.
   - On user-initiated cancel via `request.raw.on('close')`: `markSucceeded(logId)` — credits NOT restored, `refunded_at` stays null (per SPEC §10 step 6 / §14). Still tear down the abort signal.

Centralize the (g) terminal-event handling in a single `finalize(state, outcome)` helper so `markSucceeded` and `refund` are mutually exclusive and each terminal event runs exactly once.

Note: because `applyResets` runs in (a) and again inside `deduct` in (d), the second call is a cheap no-op (timestamps already advanced). Acceptable redundancy in exchange for the upfront 402 check.

### 9. Integrate deduction in `POST /api/games/:id/refine`

- Same shape as task 8. `action='refinement'`, cost 150. Game row already exists (no creation step), so order is: ownership check → `deduct` → run pipeline → finalize.
- 402 returned before any SSE bytes if insufficient.

### 10. Client: 402 handling in streaming hook

- In the shared `useStreamedGeneration` hook (SPEC §12), after `fetch` resolves, check `res.status === 402` before consuming the stream. Parse the JSON body, throw a typed `InsufficientCreditsError` with `resetAt`.
- The calling component (builder) catches the error and shows a Sonner toast: `Out of credits — resets ${formatRelative(resetAt)}.` with an action button linking to `/pricing`. (Route doesn't exist yet — link target is stable; will work in step 8.)

### 11. Client: usage bars in user dropdown

- Update `apps/web/src/components/user-dropdown.tsx` (created in step 2):
  - Read `creditsRemainingDaily`, `creditsRemainingMonthly`, `tier` from `/api/me` (TanStack Query cache key `['me']`).
  - Import `TIER_CREDIT_LIMITS` from `@arcadeai/shared/plans` (canonical export from step 02).
  - For non-admin: render `<UsageBar label="Daily credits" remaining={daily} total={TIER_CREDIT_LIMITS[tier].daily} />` and same for monthly using `.monthly`.
  - For admin: render single line "Admin — unlimited" replacing both bars.
- Implement `<UsageBar>` in `apps/web/src/components/usage-bar.tsx`:
  - Props: `label`, `remaining`, `total`.
  - Computes `pct = remaining / total`.
  - Color: `pct > 0.3 → green`, `0.1 ≤ pct ≤ 0.3 → yellow`, `pct < 0.1 → red`. Use Tailwind utility classes scoped to the existing palette.
  - Renders `${remaining} / ${total} (${Math.round(pct * 100)}%)`.
- Invalidate `['me']` after every successful generation/refinement so the bars update without a manual refresh.

### 12. Wire reset behavior on charged actions

- Confirm `applyResets` is called inside `deduct` (already in task 4). No additional integration needed — but verify by inspecting the SSE handlers in `POST /api/games` and `/refine` for any path that reads counters before calling `deduct`.

## Verification steps

Run each manually after the code is in place. All assume the dev server is running and the user is signed in.

1. **Insufficient credits → 402.** As a Free user, manually `UPDATE users SET credits_remaining_monthly = 100 WHERE id = ?`. Submit a generation. Expect HTTP 402 with `{ error: 'insufficient_credits', resetAt }` and a toast on the client. No row in `usage_log` for this attempt. No game row created.
2. **Successful generation.** As a Free user with full credits, submit a generation. After completion: `credits_remaining_daily` and `credits_remaining_monthly` both decremented by 200; `usage_log` has one row with `action='generation'`, `credits_charged=200`, `succeeded=1`.
3. **Server error → refund.** Temporarily make Sonnet throw (e.g. set `ANTHROPIC_API_KEY=invalid`). Submit a generation. After the error: counters back to pre-deduction values; `usage_log` row exists with `succeeded=0` and `refunded_at` set.
4. **User cancel → no refund.** Submit a generation, click Stop after a few chunks. After cancel: counters stay decremented; `usage_log` row marked `succeeded=1`. `refunded_at` is null.
5. **Admin user.** With an `ADMIN_EMAILS` entry signed in, submit a generation. Counters unchanged. `usage_log` row shows `credits_charged=0, succeeded=1`. Dropdown shows "Admin — unlimited".
6. **Daily reset.** `UPDATE users SET daily_reset_at = 0 WHERE id = ?` (forces past). Call `GET /api/me`. Expect `credits_remaining_daily` reset to the tier's daily allotment and `daily_reset_at` advanced to the next UTC midnight.
7. **Monthly reset.** Same as (6) but for `monthly_reset_at` and `credits_remaining_monthly`.
8. **Refinement.** Repeat (2)–(4) against `POST /api/games/:id/refine` with cost 150 and `action='refinement'`.
9. **Dropdown bar colors.** With remaining at 60% → green; manually adjust to 20% → yellow; adjust to 5% → red.
10. **Concurrent reset + deduction.** Set `daily_reset_at` to past, then immediately submit a generation. Expect `applyResets` to fire inside `deduct`, then deduct from the freshly-reset counter. End state: counter at `dailyAllotment - 200`.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — Schema + reset/charge primitives

After the schema, cost-constants, lazy-reset, charge-service, and refund-idempotency tasks complete (through task 6) and the pre-commit gate passes:

```
feat(db): add usage_log table with refund idempotency
```

Includes: `usage_log` table schema (with `refunded_at` per SPEC §5), the generated migration, `CREDIT_COSTS` in `packages/shared/src/plans.ts`, and the lazy-reset + charge/refund service modules.

### Checkpoint 2 — Endpoint integration + dropdown bars

After the remaining tasks complete (extend `/api/me`, integrate deduction in `POST /api/games` and `/refine`, 402 handling in the streaming hook, usage bars in the user dropdown) and the pre-commit gate passes:

```
feat(credits): wire deduct/refund into generation and refinement endpoints
```

Includes: extended `GET /api/me` shape, `deduct` / `finalize` calls around generation and refinement handlers, client 402 handling, and the credit-usage bars in the user dropdown.

## Rollback notes

- The migration adding `usage_log` (including `refunded_at` per SPEC §5) is additive — no existing column changes. Rollback is `DROP TABLE usage_log` plus the schema removal. No data migration concerns since this step is the first writer.
- The `/api/me` response gains fields. The frontend tolerates missing fields (TanStack Query renders `undefined` → bars show 0). Reverting the server alone won't crash the client; reverting the client alone keeps working.
- Generation/refinement integration: the new `deduct` / `finalize` calls are wrapped around existing handler bodies. Reverting them removes the credit gate entirely — safe for development but disables paid-plan enforcement. Do not roll back partially in production-like environments.
- `packages/shared/src/plans.ts` addition (`CREDIT_COSTS`) is a pure constant and safe to leave in place even if the rest is reverted; step 8 will need it. `TIER_CREDIT_LIMITS` is owned by step 02 and is not modified here.
