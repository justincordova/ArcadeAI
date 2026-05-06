# 14 — Polish Pass

## Overview

Step 14 is the final UX-quality pass before the MVP is "done." It is
**polish only** — no new routes, no new endpoints, no schema changes,
no new domain features. Every item below is grounded in an existing
spec section, primarily SPEC §12 (frontend specifics) and the spec's
list of installed shadcn primitives. The goal is to land the missing
loading skeletons, empty states, error toasts, status overlay
consistency, the settings auto-save state machine, and a minimal
keyboard shortcut set, so that the surfaces built in steps 1–13 feel
finished.

This step exists as its own pass because polish work introduced
piecemeal during feature development tends to churn (toast wording
changes, skeleton shapes drift, status text diverges across
surfaces). Doing it once at the end against a stable feature set
keeps the diff small and the result coherent.

When implementing visuals, **invoke the `frontend-design` skill** per
SPEC §12 ("When implementing UI components, invoke the
`frontend-design` skill to ensure production-grade, distinctive
design quality").

## Goals

- Land the dashboard empty-state CTA exactly as SPEC §12 describes
  ("Empty state: large 'Create your first game' CTA").
- Add `Skeleton` (SPEC §12 primitives list) loading states for
  surfaces that fetch data on first paint: dashboard grid, game card
  thumbnails, the builder iframe before the first stream chunk
  arrives, and the pricing page's per-user `ACTIVE` pill.
- Make status overlay text consistent across the builder for the
  three states SPEC §12 / §7 / §9 enumerate: `Generating...`,
  `Detected an error, fixing...`, and `Saving...` (used by the
  settings auto-save indicator per SPEC §12). One shared component,
  one set of strings.
- Confirm the **Stop** button visibility distinction is consistently
  applied: visible during initial generation and refinement (long,
  user-initiated, charged); HIDDEN during repair (short, automatic,
  free — per step 11 design).
- Wire `Sonner` toasts (SPEC §12 primitives list) into every
  user-visible error path that already exists from steps 1–13.
- Land the settings page auto-save state machine
  (`Saving...` → `Saved ✓` → fades after 1.5s) exactly per SPEC §12.
- Add a minimal keyboard-shortcut set: cmd/ctrl+enter to submit the
  builder prompt input; rely on shadcn `Dialog` defaults for esc.
  Nothing else.

## Non-goals

- **No new routes.** All 6 routes from SPEC §12 already exist by
  step 12.
- **No new API endpoints or schema changes.** Polish wires existing
  endpoints to existing UI states.
- **No new features.** If a polish item would require behavior the
  spec does not describe, it goes in **Open questions** instead of
  the catalog.
- **No keyboard shortcuts beyond the minimal set.** SPEC §12 does not
  enumerate shortcuts; cmd/ctrl+enter to submit a prompt input and
  esc to close a dialog (shadcn default) are conventional enough to
  not count as invention. Anything else is an open question.
- **No top-level React error boundary** unless explicitly approved —
  see open questions. SPEC does not mention one.
- **No mobile-responsive builder polish.** SPEC §2 explicitly puts
  builder mobile-responsiveness out of scope.
- **No accessibility audit beyond what shadcn primitives provide by
  default.** Not in spec.
- **No animation / motion design system.** The 1.5s auto-save fade
  (SPEC §12) is the only timed transition introduced here.

## Architecture / Polish item catalog

Organized by surface. Each item cites its spec basis. Anything that
cannot be cited cleanly goes under **Open questions**.

### Dashboard (`/`)

- **Empty-state CTA** (SPEC §12: "Empty state: large 'Create your
  first game' CTA"). Renders when `GET /api/games` returns an empty
  array. Replaces the grid entirely. Single primary CTA that routes
  to `/game/new`. Reachable in two ways: a brand-new account, and
  deleting the last remaining game (the latter is a free verification
  case, not a separate code path).
- **Loading skeleton for the game grid.** Use shadcn `Skeleton`
  (SPEC §12 primitives list). Shape: a grid of skeleton cards
  matching the live card aspect ratio and spacing. Renders while
  TanStack Query's `isPending` is true on the dashboard list query.
  Replaced by the empty-state CTA on empty data, or by the live grid
  on populated data.
- **Game card thumbnail skeleton on initial load.** Game rows can
  exist before a thumbnail is captured (per SPEC §7 the thumbnail
  POSTs after ~2s). When `games[i].thumbnail` is null, render a
  `Skeleton` in the card's image slot rather than a broken image.
  This case already exists in step 5 but may currently render an
  empty box; polish replaces the empty box with a `Skeleton`.
- **Last-game deletion returns to empty state.** Verification case,
  not new code: deleting the last game invalidates the dashboard
  list query, which then returns `[]`, which renders the empty
  state. Confirm the existing TanStack Query invalidation from step
  5 already covers this. If it doesn't, the fix is a single
  `queryClient.invalidateQueries` call in the existing delete
  mutation — not new behavior.

### Builder (`/game/:id` and `/game/new`)

- **Status overlay consistency pass.** Three strings from spec, one
  shared `<StatusOverlay text="..." />` component:
  - `Generating...` (SPEC §12: "Status overlay during generation:
    'Generating...' or 'Detected an error, fixing...'")
  - `Detected an error, fixing...` (same SPEC §12 sentence; also
    SPEC §7 auto-repair pipeline; also SPEC §9 repair lifecycle:
    "show 'Detected an error, fixing...' indicator (visible, not
    silent)")
  - `Saving...` is reused by the settings page (below) — same
    component, different surface.
  Today these strings may be inlined separately across step 4
  (initial generation), step 6 (refinement), and step 11 (repair).
  Polish consolidates them into a single component so the wording,
  positioning, and visual treatment cannot drift.
- **Iframe loading skeleton (pre-stream).** Between SSE `meta`
  arrival and the first `chunk` event, the iframe `srcdoc` is empty
  and the panel renders blank. Replace the blank panel with a
  `Skeleton` filling the iframe pane. Disappears on first chunk.
  This is the natural extension of SPEC §12's status overlay
  treatment for the case where streaming hasn't started yet. SPEC
  doesn't explicitly call out a separate pre-stream skeleton, but
  the `Skeleton` primitive is in the SPEC §12 install list and the
  surface is one users see today as a blank panel — flagged as a
  light open question if the reviewer wants the status overlay to
  cover this case alone instead.
- **Stop button visibility distinction** (SPEC §12: "During
  streaming: visible **Stop** button overlay that triggers the
  AbortController"). Stop is visible during initial generation
  (step 4) and refinement (step 6) — both are long, user-initiated,
  and charged. Stop is HIDDEN during repair (step 11) — repair is
  short, automatic, and free, per the step 11 design decision. Step
  14 verifies this distinction is consistently applied across the
  builder: Stop renders for `'generating'` and `'refining'` status,
  not for `'repairing'`.
- **Regenerate confirmation behavior.** SPEC §12 control bar:
  "**Regenerate** (re-runs original prompt as a fresh generation,
  charges credits)." Spec does not specify a confirm dialog, but
  the action charges credits and discards the current code, so
  surfacing the cost in a `Dialog` ("This will charge 200 credits
  and replace the current game.") before firing the request is a
  natural polish-pass guard. **Open question** — confirmation copy
  and whether to require it at all are not in spec.

### Pricing page (`/pricing`)

- **Skeleton for the per-user `ACTIVE` pill.** SPEC §12: "'ACTIVE'
  pill on user's current plan (Free/Creator/Pro only)." This pill
  depends on `GET /api/me`. Until that resolves, render a small
  `Skeleton` where the pill goes. The 4 plan cards themselves are
  hardcoded from `packages/shared/src/plans.ts` (SPEC §12) and
  render immediately — no skeleton needed for them.
- **Logged-out path** (SPEC §12: "Logged-out users: see all 4 cards
  with no 'ACTIVE' pill"). Verify no skeleton is shown when the
  user is unauthenticated; the absence of a pill is the correct
  rendered state. Verification only.
- **Admin banner** (SPEC §12: "Admin access — all features
  unlocked.") No skeleton; the banner depends on the same
  `/api/me` query as the pill. The banner can remain hidden during
  loading and appear after — visually quieter than skeletoning a
  banner.

### Settings page (`/settings`)

- **Display-name auto-save indicator state machine.** SPEC §12:
  "Display name (editable, **auto-save on blur** with inline status
  indicator: 'Saving...' → 'Saved ✓' → fades after 1.5s)." Implement
  as a small state machine local to the settings component:
  - `idle` → render nothing
  - `saving` → render `Saving...` (reuse the shared status overlay
    string component)
  - `saved` → render `Saved ✓` for 1.5s, then transition back to
    `idle`
  - `error` → toast (see toasts section); state machine returns to
    `idle`. The previously-persisted name is restored in the input.
  Trigger: input `blur` after dirty edit. The mutation is
  `PATCH /api/me { display_name }` (SPEC §11), already implemented
  in step 12.
- **Theme save failure toast.** SPEC §12 read/write path explicitly
  describes: "On PATCH failure, log the error and revert
  localStorage + DOM to the previous value with a toast ('Failed to
  save theme preference')." The toast wiring is part of this step's
  Sonner pass. Theme toggle behavior itself is unchanged from step
  12.
- **Connected accounts last-provider guard.** SPEC §12: "cannot
  disconnect the last linked provider." The disable + tooltip is
  already implemented in step 12; polish only verifies the disabled
  state and that the surfaced reason is clear.
- **Delete account confirm.** SPEC §12: "Delete account (confirm
  dialog, hard deletes user + all games + all linked OAuth
  records)." Already implemented in step 12; polish wires the
  success/failure toasts (below).

### Toasts (Sonner)

`Sonner` is in the SPEC §12 primitives install list. Polish wires it
across the existing error and confirmation paths. Toast copy is
short, action-oriented, and lowercase except for proper nouns. Each
entry below cites the spec section that describes the underlying
behavior.

| Path | Trigger | Copy / shape | Spec basis |
|---|---|---|---|
| Generation error | `POST /api/games` SSE `error` event or non-2xx | `error: "Generation failed. Please try again."` | SPEC §11 (`error` event), §17 |
| Refinement error | `POST /api/games/:id/refine` SSE `error` or non-2xx | `error: "Refinement failed. Please try again."` | SPEC §11, §7 |
| Repair fallback | 2nd repair attempt fails (handled inline as fallback dialog, not a toast) | n/a — explicit dialog per SPEC §9 | SPEC §9 (existing step 11 behavior) |
| Theme save failure | `PATCH /api/me { theme }` rejects | `error: "Failed to save theme preference."` (exact wording from SPEC §12) | SPEC §12 |
| Display name save failure | `PATCH /api/me { display_name }` rejects | `error: "Failed to save display name."` | SPEC §11, §12 |
| Billing change confirmation | `POST /api/billing/change-plan` resolves successfully | `success: "Plan updated."` | SPEC §11 (no-op endpoint), §10 |
| Account deletion confirmation | `DELETE /api/me` resolves successfully (before redirect) | `success: "Account deleted."` (brief flash before redirect to `/sign-in`) | SPEC §11, §12 |
| Rate limit | Any `/api/*` returns 429 | `error: "Too many requests. Try again in {Retry-After}s."` | SPEC §14 (rate limit, `Retry-After` header) |
| Insufficient credits | Any generation/refinement returns 402 | `error: "Out of credits."` with action button `Upgrade` linking to `/pricing` | SPEC §10 (402 Payment Required), §12 (`/pricing` route) |
| Concurrent stream | 409 from generation/refinement/repair | `error: "A generation is already in progress."` | SPEC §14 (409 with this exact message) |

The 402 toast carries an action link to `/pricing` because that is the
only surface where a user can change tier (SPEC §11
`/api/billing/change-plan`, SPEC §12 pricing page). The 429 toast
surfaces the existing `Retry-After` header value (SPEC §14).

Implementation: a single `lib/toast.ts` helper that wraps Sonner's
`toast.error` / `toast.success` with shared defaults and a single
`reportApiError(response)` helper that maps `402 → upgrade toast`,
`429 → retry toast`, `409 → concurrency toast`, anything else → a
generic error toast. Streaming SSE `error` events use the same
helper.

### Keyboard shortcuts (minimal)

SPEC §12 does not enumerate keyboard shortcuts. Polish adds the
narrowest set that is both conventional and unambiguously useful:

- **cmd/ctrl + enter** in the builder prompt input → submit the
  prompt. Submits the same form that the send button submits;
  disabled while streaming (mirrors the existing input-disabled
  behavior from SPEC §12: "Persistent prompt input at bottom,
  disabled during streaming").
- **esc** to close any open `Dialog`. This is the shadcn `Dialog`
  default — no new code, just verifying behavior.

Anything else (j/k navigation, `/` to focus, `?` for help, etc.) is
an open question — not in spec.

### Loading skeletons (summary)

Roll-up of the skeleton items above so the implementation order is
explicit:

- Dashboard grid (replaces grid until query resolves)
- Game card thumbnail (replaces image slot when `thumbnail` is null)
- Builder iframe pre-stream (replaces blank pane until first chunk)
- Pricing `ACTIVE` pill (replaces pill slot until `/api/me` resolves)

All four use shadcn `Skeleton` (SPEC §12 install list).

### Error boundary

A top-level React error boundary is **not** in SPEC. Marking as an
**open question** below. Default position: do not add it as part of
this step.

## Key decisions

- **Why polish is its own step.** Polish bolted onto each feature
  step churns: toast copy drifts, skeleton shapes diverge,
  `Generating...` vs `Generating…` vs `Generating game...` end up
  scattered across surfaces. SPEC §19 puts polish at step 14
  precisely so it lands once against a stable feature set.
- **Why Sonner.** SPEC §12 lists Sonner in the shadcn primitives
  install list. No alternative is considered.
- **Why `Skeleton`.** Same reason — listed in SPEC §12.
- **Why one shared `<StatusOverlay>` component.** Three of the four
  status strings (`Generating...`, `Detected an error, fixing...`,
  `Saving...`) appear verbatim in SPEC §12 / §7 / §9. Centralizing
  prevents wording drift across the builder and settings page.
- **Why a minimal keyboard-shortcut set.** SPEC §12 doesn't
  enumerate shortcuts. cmd/ctrl+enter to submit and esc to close
  are conventional enough to not be inventions; anything else is.
- **Why a 402 action link to `/pricing` and not a credit-grant
  button.** `/pricing` is the only surface that calls
  `/api/billing/change-plan` (SPEC §11). Routing the user there is
  the only valid recovery path in the prototype.
- **Why no new error boundary.** SPEC does not describe one.
  Listed as an open question for the reviewer.

## Open questions

Each item below is something polish could plausibly include but
that is not directly grounded in spec. Default position: **do not
implement** unless the reviewer approves.

1. **Top-level React error boundary.** SPEC does not mention one.
   Adding one would catch render-time crashes anywhere in the app
   and show a recovery UI. Recommend approving since the prototype
   currently has no global crash recovery, but it is genuinely a new
   surface.
2. **Regenerate confirmation dialog.** SPEC §12 describes the
   Regenerate button but not a confirmation step. A confirm dialog
   reduces accidental credit burn but is not in spec. Recommend
   approving with the copy "This will charge 200 credits and
   replace the current game."
3. **Pre-stream iframe skeleton vs. status overlay alone.** SPEC §12
   describes the status overlay during generation; it does not
   distinguish "after meta but before first chunk" as a separate
   visual state. Both options are minor; defaulting to a skeleton
   for visual consistency with the rest of this pass.
4. **Keyboard shortcuts beyond cmd/ctrl+enter and esc.** Anything
   else (navigation, focus, help) would be an invented feature.
   Default: do not add.
5. **Toast for successful generation / refinement / repair.**
   Streams emitting `done` already update the iframe visibly; an
   additional success toast would be redundant noise. Default: do
   not add.
6. **Toast deduplication strategy.** If the same error fires
   repeatedly (e.g. a flaky stream that retries), Sonner stacks
   toasts by default. Sonner supports a `toast.id` to deduplicate.
   Default: use a stable `id` per error category so retries
   collapse to one visible toast at a time.
7. **Banner-style messaging vs. toasts.** Some apps prefer a
   persistent banner for "Out of credits" rather than a transient
   toast. SPEC §12 does not describe a banner. Default: toast only.

## Acceptance criteria

The step is complete when all of the following hold. Each criterion
maps to a verification step in the implementation plan.

1. **Dashboard empty state.** A user with zero games sees the large
   "Create your first game" CTA per SPEC §12. Deleting the last
   game returns the dashboard to the empty state without a manual
   refresh.
2. **Dashboard loading skeleton.** While the dashboard list query is
   pending, a skeleton grid is visible. It is replaced by either
   the live grid or the empty-state CTA based on the resolved data.
3. **Game card thumbnails.** Cards with `thumbnail === null` render
   a `Skeleton` in the image slot, not an empty box.
4. **Builder pre-stream skeleton.** Between SSE `meta` arrival and
   first `chunk`, the iframe pane renders a `Skeleton` (or, if open
   question 3 resolves to "status overlay alone," the
   `Generating...` overlay alone). Replaced on first chunk.
5. **Status overlay consistency.** All three builder states render
   through the shared `<StatusOverlay>` component using the spec
   strings exactly: `Generating...`, `Detected an error,
   fixing...`, `Saving...`.
6. **Stop button visibility distinction.** Visible during initial
   generation and refinement; HIDDEN during repair (per step 11
   design — repair is short, automatic, and free). Clicking Stop on
   generation or refinement aborts the stream via the existing
   AbortController wiring (SPEC §14) and credits are not refunded
   (SPEC §14).
7. **Pricing `ACTIVE` pill skeleton.** A `Skeleton` is rendered in
   the pill slot until `GET /api/me` resolves; the live `ACTIVE`
   pill (or its absence for non-matching tiers / logged-out / admin
   per SPEC §12) is then rendered.
8. **Settings auto-save state machine.** Editing the display name
   and blurring transitions through `Saving...` → `Saved ✓` →
   (fade after 1.5s) → idle. Failure path shows an error toast and
   the input reverts to the persisted value.
9. **Sonner toasts wired** for every row of the table above.
   Manual exercise:
   - Trigger a generation error → error toast appears.
   - Refinement error → error toast.
   - Theme PATCH failure → "Failed to save theme preference."
   - 402 from generation → toast with `Upgrade` action linking to
     `/pricing`.
   - 429 from any `/api/*` → toast with `Retry-After` value.
   - 409 from a second concurrent generation → toast.
   - Successful billing change → success toast.
   - Successful account deletion → success toast briefly visible
     before redirect.
10. **Keyboard shortcuts.** cmd/ctrl+enter in the builder prompt
    input submits the prompt (when not streaming); esc closes any
    open `Dialog`.
11. **No spec deviations.** No new routes, endpoints, schema
    changes, or features. Diff is restricted to the existing UI
    code paths plus shared toast/skeleton/status helpers.
12. **`frontend-design` skill invoked** during the visual passes per
    SPEC §12.
