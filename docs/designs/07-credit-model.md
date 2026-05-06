# 07 — Credit Model + Usage Tracking

## Overview

Step 7 introduces the credit accounting layer that governs generation and refinement. Per SPEC §10, every generation costs 200 credits and every refinement costs 150 credits, charged against per-user daily and monthly counters with lazy reset. This step adds the `usage_log` table, a charge service that performs optimistic deduction and conditional refund, lazy-reset on read, and the user-dropdown usage bars defined in SPEC §12. Auto-repair (charges 0) and the pricing/billing UI are deliberately out of scope here.

## Goals

- Persist a `usage_log` row for every generation and refinement attempt (succeeded or not), per SPEC §5.
- Enforce credit checks before LLM work begins on `POST /api/games` and `POST /api/games/:id/refine`, returning 402 with reset time on insufficient credits (SPEC §10, §11).
- Optimistically deduct on request entry, refund on unrecoverable server-side error, mark the log row succeeded on completion (SPEC §10, §14).
- Lazy reset of `credits_remaining_daily` at UTC midnight and `credits_remaining_monthly` at the first of the month UTC, executed on read of `/api/me` and at the start of every charged action (SPEC §10).
- Extend `GET /api/me` to expose `credits_remaining_daily`, `credits_remaining_monthly`, `daily_reset_at`, `monthly_reset_at`, `tier` (SPEC §11).
- Render daily and monthly usage bars in the user dropdown with the green/yellow/red thresholds and the "Admin — unlimited" variant (SPEC §12).
- Surface 402 responses on the client with a toast that links to `/pricing`.

## Non-goals

- Pricing page, plan badge in top bar, and billing/change-plan endpoint (SPEC build step 8).
- Auto-repair endpoint and `usage_log` rows with `action='repair'` (SPEC build step 11). The schema permits the value but no code path writes it in step 7.
- Admin tier assignment logic (already done in step 2 via `databaseHooks.user.create.before`, SPEC §10).
- Initial credit allotment on user creation (already done in step 2).
- Replacing the in-memory concurrency cap (SPEC §14) — credits are a separate axis.
- Stripe wiring or any real billing.

## Architecture

### Schema

`usage_log` is declared in full by SPEC §5, including the `refunded_at INTEGER` column (nullable, set once on refund; refund idempotency is enforced by the `refunded_at IS NULL` check per SPEC §10 step 4). This step adds no spec extensions to the schema — it consumes SPEC §5 verbatim.

Indexes: `(user_id, created_at)` for future per-user history queries. No other indexes needed in step 7.

`game_id` is nullable and `on delete set null` so deleting a game preserves the audit trail.

### Charge service

`apps/server/src/services/usage/charge.ts` exposes three functions over a single SQLite transaction each:

- `deduct(userId, action, gameId?) → { logId, refundIfFailed }` — runs `applyResets`, checks `tier === 'admin'` (in which case writes a log row with `credits_charged=0`, `succeeded=0` and returns a no-op `refundIfFailed`), then verifies the relevant counter has enough credits per SPEC §10 (Free: daily and monthly; Creator/Pro/Admin: monthly only). Decrements both `credits_remaining_daily` and `credits_remaining_monthly` by the action cost for observability; the daily check is skipped for paid tiers. Inserts the log row with `succeeded=0, refunded_at=null`. On insufficient credits throws `InsufficientCreditsError` carrying the next reset time.
- `markSucceeded(logId)` — sets `succeeded=1`. Idempotent.
- `refund(logId)` — restores the deducted amount to both counters, leaves `succeeded=0`, and sets `refunded_at=now` (SPEC §10 step 4: "refund credits AND set `refunded_at = now`, leave log row marked `succeeded = 0`"). Idempotent via the `refunded_at IS NULL` guard from SPEC §10 — a second call is a no-op.

Costs are pulled from a single source of truth in `packages/shared/src/plans.ts`, alongside the canonical `TIER_CREDIT_LIMITS` export established by step 02. This step adds a separate `CREDIT_COSTS` map: `{ generation: 200, refinement: 150, repair: 0 }`. `CREDIT_COSTS` is a per-action cost table — a different concept from `TIER_CREDIT_LIMITS` (per-tier allotments) — so the two coexist without overlap. Step 07 does NOT redeclare allotments.

### Lazy reset helper

`apps/server/src/services/usage/reset.ts` exposes `applyResets(userId)` which, in one transaction:

1. Loads `tier`, `daily_reset_at`, `monthly_reset_at` for the user.
2. If `now >= daily_reset_at`: set `credits_remaining_daily` to `TIER_CREDIT_LIMITS[tier].daily`, set `daily_reset_at` to next UTC midnight. Per SPEC §10 "Daily counter for paid tiers", paid tiers' daily values mirror their monthly allotment — the counter is decremented for observability, but the daily check is skipped in `deduct`.
3. If `now >= monthly_reset_at`: set `credits_remaining_monthly` to `TIER_CREDIT_LIMITS[tier].monthly`, set `monthly_reset_at` to first of next month UTC.
4. Admin tier short-circuits: counters are not maintained (admin bypasses checks per SPEC §10), but reset timestamps are still advanced to keep the row consistent.

`applyResets` is invoked at the start of `deduct` and at the start of `GET /api/me`.

### Integration points

- **`POST /api/games`** (added in step 4): the 402 check happens upfront — before any DB writes — by calling `applyResets(userId)` and reading the user's counter against `CREDIT_COSTS.generation`. If insufficient, return 402 before creating any rows or opening SSE. Otherwise, the game row creation comes first (SPEC §11 — the `meta` event needs `gameId`), then `deduct(userId, 'generation', gameId)` writes the `usage_log` row with that `gameId`. On stream success, call `markSucceeded(logId)`. On server-side error during streaming, call `refund(logId)`. On client cancellation (detected via `request.raw.on('close')`), call `markSucceeded(logId)` — credits are not refunded on cancel per SPEC §14.
- **`POST /api/games/:id/refine`** (added in step 6): same shape with `action='refinement'`, cost 150.
- **`GET /api/me`** (existing from step 2): call `applyResets(userId)` first, then return `{ id, email, displayName, tier, theme, creditsRemainingDaily, creditsRemainingMonthly, dailyResetAt, monthlyResetAt }`. Admin tier returns the counters as-is; the client interprets `tier === 'admin'` to render unlimited.

### Failure-mode mapping

| Outcome                                  | Counter | Log row              |
|------------------------------------------|---------|----------------------|
| Insufficient credits before deduction    | n/c     | none                 |
| Stream completes successfully            | -cost   | `succeeded=1`        |
| Server error after deduction             | refund  | `succeeded=0`        |
| User cancels (AbortController)           | -cost   | `succeeded=1`        |
| Admin user, any outcome                  | n/c     | `credits_charged=0`, `succeeded=1` on success |

The "user cancels → succeeded=1" choice reads strangely but matches SPEC §14: tokens were spent, the model partially produced output, the user got value (or chose to discard it). Marking `succeeded=0` would imply a system failure.

### Client (user dropdown)

`apps/web/src/components/user-dropdown.tsx` consumes `/api/me` via TanStack Query. Two `<UsageBar>` components render daily and monthly:

- Width = `creditsRemainingX / tierAllotmentX` (allotments come from `packages/shared/src/plans.ts`).
- Color: green if remaining/total > 0.30, yellow if 0.10–0.30, red if < 0.10 (SPEC §12).
- Label: `${remaining} / ${total} (${pct}%)`.
- Admin tier: replace both bars with a single line "Admin — unlimited" (SPEC §12).

402 responses from `POST /api/games` / `/refine` are handled by the existing fetch wrapper used by the streaming hook. The hook surfaces a typed error; the calling component shows a `Sonner` toast: "Out of credits — resets at <time>. Upgrade your plan." with a link to `/pricing` (the route is added in step 8 but the link target is stable).

## Key decisions

- **Optimistic deduction over reservation.** The simpler model. Reservation requires a separate "held credits" column and a TTL/sweeper job. Per SPEC §10 step 3 the spec already prescribes optimistic deduction, and refunds cover the only failure mode that matters (server-side errors). The streaming-cancel case explicitly does not refund (SPEC §14), so a reservation system would be over-engineered.
- **Log all attempts, including failures.** SPEC §5 schema requires `succeeded` as a column, and SPEC §10 step 4 says "leave log row marked succeeded = 0" on failure — i.e. the row exists. This gives observability into both failed-but-charged (cancel) and failed-and-refunded (server error) cases via `(credits_charged > 0, succeeded = 0)` filters in future analytics.
- **No refund on user cancel.** Direct restatement of SPEC §14: "Credits are NOT refunded on user-initiated cancel — tokens have already been spent up to the abort point."
- **Lazy reset on read instead of a scheduled job.** SPEC §5 explicitly: "Daily and monthly counters reset lazily on read." A scheduled job would require process supervision the prototype doesn't have, and lazy reset has zero cost at idle. Reset triggers on every `/api/me` call and every charged action — the only places that observe the counters.
- **Admin bypass at the deduct layer, not at the route.** Routes call `deduct` unconditionally; `deduct` checks `tier === 'admin'` and short-circuits with a zero-cost log row. This keeps the route handlers free of tier branches and keeps admin observable in `usage_log` (SPEC §10: admins still produce log rows, just with `credits_charged=0`). Note: SPEC §10 only specifies that auto-repair logs zero; admin logging is an implementation choice consistent with §17's emphasis on usage observability.
- **Cost source of truth in `packages/shared/src/plans.ts`.** Same module as tier allotments. The frontend needs allotments to compute usage-bar percentages anyway.

## Resolved decisions

- **Refund idempotency tracking.** SPEC §5 declares `usage_log.refunded_at INTEGER` (nullable). SPEC §10 step 4 makes the idempotency contract explicit: refund sets `refunded_at = now` and is a no-op if `refunded_at IS NOT NULL`. No plan-side spec extension required.
- **Daily counter for paid tiers.** SPEC §10 "Daily counter for paid tiers" resolves this: only Free has an enforced daily cap. Creator/Pro/Admin have no daily cap — `credits_remaining_daily` is decremented by `deduct` for observability but the daily check is skipped. `TIER_CREDIT_LIMITS` (step 02) carries `dailyEnforced: false` for paid tiers.
- **`game_id` on the deduction for `POST /api/games`.** The game row is created before `deduct` runs (so the SSE `meta` event can fire), so we have the id. The log row gets `game_id` set. The 402 pre-check uses `applyResets` + a counter read on the user, so no row is created if credits are insufficient.

## Open questions

- **Refund granularity on partial-stream server errors.** SPEC §14 distinguishes user-cancel (no refund) from server-error (refund). If a generation streams 80% of the HTML and then the LLM provider returns a mid-stream error, do we refund? Default position: yes, refund — the user did not get a working game, and SPEC §17 emphasizes "credit model honesty." Mark as a deliberate interpretation; revisit if it becomes a cost issue.

## Acceptance criteria

1. `usage_log` table exists with the SPEC §5 schema and a `(user_id, created_at)` index.
2. `POST /api/games` and `POST /api/games/:id/refine` return 402 with `{ error, reset_at }` body when the relevant counter is below the action cost, and write no log row.
3. Successful generation decrements both daily and monthly counters by 200 (refinement: 150), writes a `usage_log` row with `succeeded=1`.
4. Server-side error during streaming refunds both counters by the original cost, leaves the `usage_log` row with `succeeded=0`.
5. User-initiated cancel during streaming → `usage_log.succeeded = 1`, `refunded_at = null`, counters NOT restored (per SPEC §14).
6. Admin users do not see counters decrement; their `usage_log` rows show `credits_charged=0`.
7. `GET /api/me` returns the current counters and reset timestamps after applying any due resets.
8. The user dropdown renders two usage bars (daily, monthly) with correct percentages and color thresholds; admin sees "Admin — unlimited" instead.
9. Manually advancing `daily_reset_at` into the past and calling `/api/me` resets the daily counter to the tier allotment and advances `daily_reset_at` to the next UTC midnight. Same for monthly.
10. The client surfaces a toast linking to `/pricing` on a 402 response.
