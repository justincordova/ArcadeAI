# 14 — Polish Pass — Implementation Plan

Implements the design in `docs/designs/14-polish-pass.md`. Grounded
in SPEC §7, §9, §10, §11, §12, §14, §19. Polish only — no new
routes, endpoints, schema, or features.

## Pre-flight

Confirm the following before starting. Stop and resolve if any item
is missing.

- **Steps 1–13 complete.** All routes from SPEC §12 exist
  (`/`, `/game/:id`, `/game/new`, `/pricing`, `/settings`,
  `/sign-in`). All API endpoints from SPEC §11 exist. Auth, game
  CRUD, generation, refinement, credit model, pricing, RAG, genre
  classification, auto-repair, settings, and logging+rate-limit
  passes have all landed.
- **shadcn primitives installed.** Per SPEC §12: `Button`, `Dialog`,
  `DropdownMenu`, `Tooltip`, `Sonner`, `Avatar`, `Skeleton`,
  `Switch`, `Tabs`, `Input`, `Label`, `Separator`. Verify
  `Sonner` and `Skeleton` specifically — both are central to this
  step. Install any missing primitive via the standard shadcn CLI
  before starting.
- **Sonner Toaster mount point.** Confirm `<Toaster />` is mounted
  at the app root (e.g. inside the root TanStack Router layout). If
  it is not, the first task below adds it; otherwise reuse it.
- **Open questions resolved.** Before starting, the developer
  should answer the open questions in the design doc — at minimum:
  - Top-level React error boundary: yes / no.
  - Regenerate confirmation dialog: yes / no, and copy.
  - Pre-stream iframe skeleton vs. status overlay alone.
  Default to "no / status overlay alone" if unspecified; revisit
  during execute review.

If any pre-flight item is missing, stop and resolve before
continuing.

## Ordered tasks

Tasks are ordered to minimize churn: shared primitives first
(skeleton, status overlay, toast helpers), then surface-by-surface
wiring. Each task should land as a single small, reviewable diff.

### 1. Shared `<StatusOverlay>` component

Create `apps/web/src/components/status-overlay.tsx`. Props:
`{ text: string }`. Renders a centered overlay matching the existing
generation-overlay styling from step 4 (positioned absolutely over
the parent surface, with the same backdrop / typography). Export the
spec strings as named constants:

```ts
export const STATUS_GENERATING = 'Generating...'
export const STATUS_REPAIRING = 'Detected an error, fixing...'
export const STATUS_SAVING = 'Saving...'
```

Verbatim from SPEC §12 / §7 / §9. Replace the inline overlay JSX in
the step 4 builder, the step 6 refinement path, and the step 11
repair path with this component. No behavior change — only
deduplication. Invoke the `frontend-design` skill on this component
since it is the visual unit reused across the builder.

**Review checkpoint.** Confirm the three call sites all render
identically before proceeding.

### 2. Shared toast helper

Create `apps/web/src/lib/toast.ts`:

- `toastError(message: string, options?)` — wraps Sonner's
  `toast.error` with shared defaults (duration, position).
- `toastSuccess(message: string, options?)` — wraps `toast.success`.
- `reportApiError(response: Response | { status: number, ... })` —
  central mapping:
  - `402` → `toast.error('Out of credits.', { action: { label: 'Upgrade', onClick: () => router.navigate('/pricing') } })`
  - `429` → read `Retry-After` header, render
    `Too many requests. Try again in {n}s.`
  - `409` → render `'A generation is already in progress.'`
    (matches the literal SPEC §14 server message; idempotent so
    server and client wording match)
  - any other non-2xx → generic
    `'Something went wrong. Please try again.'`
- All toasts pass a stable `id` per category so repeated triggers
  collapse to a single visible toast (open question 6 default).

Mount `<Toaster />` at the app root if not already present. Use
shadcn's Sonner integration defaults; do not customize beyond what
is needed for legibility in both dark and light themes (SPEC §12
theme section).

### 3. Skeleton primitives

Add small wrappers in `apps/web/src/components/skeletons/`:

- `dashboard-grid-skeleton.tsx` — grid of N skeleton cards matching
  the live dashboard card shape and aspect ratio.
- `game-card-thumbnail-skeleton.tsx` — single skeleton sized to fill
  the image slot of a game card.
- `iframe-skeleton.tsx` — single skeleton filling the iframe pane.
- `pricing-active-pill-skeleton.tsx` — small pill-shaped skeleton.

All built on shadcn's `Skeleton` primitive (SPEC §12). Invoke the
`frontend-design` skill for the dashboard grid skeleton (it is the
most visible) — the rest can match its visual language.

### 4. Dashboard empty state

In the dashboard route component:

- When `useQuery(['games'])` is `pending`, render
  `<DashboardGridSkeleton />`.
- When data resolves to `[]`, render the empty-state CTA per SPEC
  §12: large "Create your first game" call-to-action linking to
  `/game/new`. Replaces the grid entirely.
- When data is non-empty, render the live grid (existing step 5
  code) — including the `+ New Game` first card.

Verify the existing delete mutation invalidates the dashboard list
query so deleting the last game returns the user to the empty
state. If invalidation is missing, add a single
`queryClient.invalidateQueries({ queryKey: ['games'] })` in the
delete `onSuccess` — no other changes.

Invoke the `frontend-design` skill on the empty-state visual.

### 5. Game card thumbnail skeleton

In the game card component (step 5), render
`<GameCardThumbnailSkeleton />` in the image slot when
`game.thumbnail == null`. When non-null, render the `<img>` as
today.

### 6. Builder iframe pre-stream state

In the builder iframe panel:

- Before SSE `meta` arrives: nothing rendered (pre-existing state).
- After `meta` arrives, before first `chunk`: render either
  `<IframeSkeleton />` or `<StatusOverlay text={STATUS_GENERATING} />`
  per the resolved open question 3. Default to the status overlay
  alone if unresolved (lower visual cost, already in spec).
- On first `chunk`: render the iframe with `srcdoc` and overlay
  `<StatusOverlay text={STATUS_GENERATING} />` until `done`.
- On repair: overlay `<StatusOverlay text={STATUS_REPAIRING} />`
  for the duration of the repair stream.

No new state machine — these conditions slot into the existing
streaming state from steps 4 / 6 / 11.

### 7. Stop button visibility distinction across streaming paths

Verify Stop visibility matches the step 11 design decision:

- Initial generation (step 4) — Stop overlay MUST be visible per
  SPEC §12. Verify.
- Refinement (step 6) — Stop overlay MUST be visible. If missing,
  add by reusing the same `<StopButton />` component from step 4.
- Repair (step 11) — Stop overlay MUST be HIDDEN. Repair is short,
  automatic, and free; the status overlay is read-only. If Stop is
  rendering during repair, gate its visibility to exclude
  `status === 'repairing'` (per the step 11 plan task 10).

All three streams share streaming hook plumbing, so the fix in any
direction is a one-line render gate in the builder, not new
infrastructure.

### 8. Sonner toast wiring across error paths

Walk each row in the design doc's toast table and wire it. Every
wiring touches existing code paths only — no new endpoints or
mutations.

- **Generation error / refinement error / repair fallback.** In
  the `useStreamedGeneration` hook (or the route components that
  consume it), call `reportApiError` on:
  - SSE `error` event (`{ message, code? }`)
  - Non-2xx initial response (covers 402 / 429 / 409 before stream
    starts)
  - Network failure
  Repair fallback after 2nd failure stays as the existing dialog
  from step 11 — no toast there per the design doc.
- **Theme save failure.** In the theme mutation `onError` (step
  12), call
  `toastError('Failed to save theme preference.')` — exact wording
  from SPEC §12. The mutation already reverts localStorage and DOM
  per SPEC §12; this only adds the toast.
- **Display name save failure.** In the auto-save mutation (next
  task) `onError`, call
  `toastError('Failed to save display name.')`.
- **Billing change confirmation.** In the
  `POST /api/billing/change-plan` mutation `onSuccess` from step 8,
  call `toastSuccess('Plan updated.')`.
- **Account deletion confirmation.** In the `DELETE /api/me`
  mutation `onSuccess` from step 12, call
  `toastSuccess('Account deleted.')` immediately before the hard
  navigation to `/sign-in`. The toast may flash briefly before
  navigation; that is acceptable and intentional.
- **402 / 429 / 409.** Already covered by `reportApiError`.

After this task, every existing user-visible failure path produces a
toast.

### 9. Settings auto-save state machine

In the settings route component (step 12):

Add local state `status: 'idle' | 'saving' | 'saved' | 'error'`.
On display-name input `blur`, if the value differs from the
persisted value:

- Set `status = 'saving'`. Render
  `<StatusOverlay text={STATUS_SAVING} />` inline next to the
  input (or a small inline variant — see frontend-design pass).
- Fire the existing `PATCH /api/me { display_name }` mutation.
- `onSuccess`: set `status = 'saved'`, render `Saved ✓`. Start a
  1.5s timer; on tick, set `status = 'idle'`.
- `onError`: set `status = 'error'`, fire
  `toastError('Failed to save display name.')`, restore the
  input value to the previously-persisted name, set
  `status = 'idle'`.

The `Saving...` string comes from `STATUS_SAVING` to keep wording
locked to spec. The `Saved ✓` / 1.5s fade are explicit in SPEC §12.
Use `setTimeout` with cleanup on unmount; do not introduce a
state-machine library.

Invoke the `frontend-design` skill on the inline status indicator
treatment.

### 10. Pricing `ACTIVE` pill skeleton

In the pricing route component (step 8):

- While `useQuery(['me'])` is `pending`, render
  `<PricingActivePillSkeleton />` in the pill slot of every plan
  card.
- After `/api/me` resolves:
  - Authenticated non-admin: render the `ACTIVE` pill on the
    matching tier (Free/Creator/Pro per SPEC §12), nothing on
    others.
  - Admin: render the admin banner, no `ACTIVE` pill on any card
    (SPEC §12).
  - Logged-out: no pill, no banner (SPEC §12). Verify only — no
    skeleton should appear in this case since `/api/me` returns
    quickly with an unauthenticated indicator.

### 11. Minimal keyboard shortcuts

In the builder prompt input component:

- On `keydown`, if `event.key === 'Enter'` and
  (`event.metaKey || event.ctrlKey`) and the input is not
  disabled (i.e. not currently streaming, per SPEC §12), call
  `event.preventDefault()` and submit the form. Reuse the
  existing submit handler — do not duplicate logic.

For `esc`-closes-Dialog: verify shadcn `Dialog` defaults work on
all dialogs introduced in steps 1–13 (rename, delete, regenerate
confirm if approved, repair fallback, account delete confirm). No
new code expected.

### 12. (Optional) Regenerate confirmation dialog

Only if open question 2 is approved. In the builder control bar:

- Wrap the existing Regenerate button in a confirmation `Dialog`
  with the copy from the design doc / open question resolution.
- Confirm fires the existing Regenerate handler (re-runs original
  prompt as a fresh generation per SPEC §12). Cancel closes the
  dialog.

Skip this task entirely if the open question resolves to "no
confirmation."

### 13. (Optional) Top-level React error boundary

Only if open question 1 is approved. Add an error boundary at the
TanStack Router root layout. On render-time error:

- Render a minimal recovery UI ("Something went wrong. Reload the
  page.") with a reload button.
- Log the error to the console (no telemetry endpoint in MVP).

Skip this task entirely if the open question resolves to "no error
boundary."

### 14. Frontend-design pass

After all wiring is complete, do a single visual pass invoking the
`frontend-design` skill on:

- The dashboard empty state.
- The dashboard grid skeleton.
- The shared `<StatusOverlay>`.
- The settings auto-save inline indicator.

This is intentionally last so the skill operates on stable
component shapes rather than churning during wiring.

## Verification steps

Manually exercise each surface. The design doc's acceptance criteria
maps 1:1 to the steps below; failing any step blocks the merge.

1. **Empty dashboard.** Sign in as a brand-new account (or delete
   all games on an existing one). Visit `/`. The "Create your first
   game" CTA renders. Click it; routes to `/game/new`.
2. **Dashboard loading skeleton.** Throttle the network in DevTools
   to a slow profile and reload `/`. Confirm the skeleton grid
   renders before the live grid / empty state.
3. **Last-game deletion.** From a one-game dashboard, delete the
   game via the kebab menu. Confirm the dashboard returns to the
   empty state without a manual refresh.
4. **Game card thumbnail skeleton.** Trigger a fresh generation;
   immediately navigate back to `/`. The new card should show a
   skeleton in the image slot until the thumbnail POST completes
   (~2s per SPEC §7).
5. **Builder pre-stream state.** Submit a prompt at `/game/new`.
   Confirm the iframe pane renders the resolved pre-stream visual
   (skeleton or status overlay alone) between `meta` and first
   `chunk`, then transitions cleanly to the streaming iframe with
   `Generating...` overlay.
6. **Status overlay strings.** Verify the three states render the
   exact spec strings:
   - Generation → `Generating...`
   - Repair → `Detected an error, fixing...` (induce by hand-
     editing a generated game in DevTools to throw)
   - Settings save → `Saving...`
7. **Stop button visibility distinction.** Confirm the Stop overlay
   is visible during initial generation and refinement, and HIDDEN
   during repair (per step 11 design). Click Stop during refinement;
   confirm the stream aborts and credits are not refunded (per SPEC
   §14, verifiable via the usage bars in the user dropdown). Induce
   a repair and confirm no Stop control is rendered while the
   "Detected an error, fixing..." overlay is showing.
8. **Pricing `ACTIVE` pill skeleton.** Throttle the network and
   visit `/pricing` while authenticated. Confirm the pill slot
   shows a skeleton briefly, then resolves to either an `ACTIVE`
   pill (Free/Creator/Pro) or nothing (admin / logged-out).
9. **Settings auto-save.** On `/settings`, edit the display name
   and tab out / blur. Observe `Saving...` → `Saved ✓` → fade
   after 1.5s. Then simulate a server failure (e.g. temporarily
   stop the server, or use DevTools to fail the PATCH); confirm
   the error toast appears and the input reverts to the
   previously-persisted name.
10. **Generation error toast.** Force a generation failure (e.g.
    invalid Anthropic key in `.env`, restart the server). Submit
    a prompt; confirm the error toast appears.
11. **Insufficient credits toast.** Manually set the test user's
    credits to 0 in the DB. Submit a prompt; confirm the 402
    toast appears with an `Upgrade` action that routes to
    `/pricing`.
12. **Rate-limit toast.** Hammer `/api/games` past the per-IP cap
    (60 req/min, SPEC §14) — or temporarily lower the cap in
    `@fastify/rate-limit` config to a small number for the test.
    Confirm the 429 toast appears with the `Retry-After` value
    interpolated.
13. **Concurrency toast.** Submit two generation requests in
    rapid succession (open two tabs, submit on both). Confirm the
    second produces the 409 toast with the literal SPEC §14
    message.
14. **Theme failure toast.** Temporarily fail `PATCH /api/me`
    (e.g. with a server-side guard for the test). Toggle theme;
    confirm the toast `'Failed to save theme preference.'` appears
    and the theme reverts (existing SPEC §12 behavior).
15. **Billing / deletion success toasts.** Use the pricing page
    (no-op endpoint per SPEC §11) to change plans; confirm the
    success toast. On `/settings`, trigger account deletion;
    confirm the success toast briefly precedes the redirect to
    `/sign-in`.
16. **cmd/ctrl + enter.** In the builder, focus the prompt input,
    type a prompt, press cmd/ctrl + enter. Confirm submission.
    Press during streaming → no-op (input disabled per SPEC §12).
17. **esc closes dialogs.** Open each dialog (rename, delete,
    regenerate confirm if added, repair fallback, account
    delete). Press esc on each; confirm it closes.

If all 17 steps pass, the polish step is done.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — End of plan

After all 17 polish tasks complete and the pre-commit gate passes:

```
feat(ui): polish pass — empty states, skeletons, shortcuts
```

Includes: shared status/skeleton/toast primitives, empty-state surfaces, keyboard-shortcut bindings, and the per-surface UI tweaks listed in the task list.

## Rollback notes

Polish is additive and surface-scoped, so rollback is per-task:

- Each shared primitive (`<StatusOverlay>`, toast helpers, skeleton
  wrappers) lives in a new file. Removing the file plus reverting
  its call sites restores prior behavior.
- Sonner toast wiring is one `onError` / `onSuccess` call per
  mutation — easy to delete without touching mutation logic.
- The settings auto-save state machine is local component state.
  Reverting that file alone removes it.
- Keyboard shortcut handlers are localized to the builder prompt
  input. Reverting that one file removes them.
- The optional regenerate confirmation and error boundary, if
  landed, can each be reverted independently of the rest.

No DB migrations, no schema changes, no env changes, no API
contract changes. Rollback risk is low and surface-by-surface.
