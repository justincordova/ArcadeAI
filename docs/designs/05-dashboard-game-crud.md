# 05 — Dashboard + game CRUD UI

## Overview

Build-order step 5 from SPEC.md §19. With step 4 in place, a user can stream
a single game into existence at `/game/new` and reload it at `/game/:id`. They
have no way to *find* their previously-created games, no way to rename them,
and no way to delete them. This step adds the dashboard surface and the
remaining game-CRUD endpoints required to drive it.

Concretely, this step ships:

- `GET /api/games` — list endpoint for the dashboard grid (SPEC.md §11).
- `PATCH /api/games/:id` — title rename, the only mutable field exposed
  (SPEC.md §11).
- `POST /api/games/:id/thumbnail` — accepts a base64 PNG data URL captured
  from the iframe canvas (SPEC.md §11).
- Dashboard route `/` — grid of game cards with thumbnail / title / last
  edited timestamp, "+ New Game" tile, empty state, hover-revealed kebab
  menu with Rename and Delete (SPEC.md §12).
- Client-side thumbnail capture wired into the builder, fired only on
  successful generation completion — never during streaming (SPEC.md §12).

This step assumes step 3's `DELETE /api/games/:id` and `GET /api/games/:id`
already exist and that the `games` row carries a nullable `thumbnail`
column matching SPEC.md §5.

## Goals

- Dashboard renders all games owned by the current user, ordered by
  `updated_at desc`, with thumbnail / title / last-edited timestamp
  (SPEC.md §12).
- "+ New Game" tile is the first card; clicking routes to `/game/new`
  (SPEC.md §12).
- Empty state (no games yet) shows a "Create your first game" CTA
  (SPEC.md §12).
- Hovering a card reveals a `⋯` kebab; clicking opens a shadcn
  `DropdownMenu` with **Rename** and **Delete** (SPEC.md §12).
- Rename → inline-edit the title in place, persists via
  `PATCH /api/games/:id` on commit. Optimistic update via TanStack
  Query mutation.
- Delete → confirm dialog (shadcn `Dialog`), then
  `DELETE /api/games/:id`. List re-renders without the row.
- Thumbnail capture on the builder side: after the SSE `done` event,
  read the iframe's `<canvas>` via `canvas.toDataURL('image/png')`,
  POST it to `/api/games/:id/thumbnail`. Never during streaming
  (SPEC.md §12 — "thumbnails update only on successful
  generation/refinement completion").
- `GET /api/games` returns only `id`, `title`, `thumbnail`,
  `updated_at` per SPEC.md §11. Full code is fetched only when the
  user opens a game.
- All endpoints auth-gated; ownership mismatch returns 404 not 403
  (SPEC.md §14).
- Zod validation on `PATCH` and thumbnail bodies (SPEC.md §14).

## Non-goals

Explicitly deferred — do not implement in this step:

- **No list pagination, no infinite scroll, no virtualization.** Small
  per-user libraries are assumed. Revisit if a user accumulates
  hundreds of games.
- **No bulk actions** (multi-select, bulk delete). Single-card
  operations only.
- **No search or filter** on the dashboard.
- **No sorting controls.** Server returns `updated_at desc`; client
  renders in that order.
- **No right-click context menu.** SPEC.md §12 explicitly excludes it
  ("conflicts with the browser default").
- **No drag-to-reorder, no folders, no tags.**
- **No public sharing, no thumbnail-on-hover preview animations.**
- **No refinement-triggered thumbnail recapture.** Refinement is step
  6; the thumbnail-capture wiring built here will be reused in step 6
  by hooking the same `done` event in the refinement stream. Out of
  scope for this step's verification.
- **No GPT-4.1-mini title generation.** SPEC.md §7 mentions a
  `PATCH /api/games/:id` written by the title-generation pipeline;
  this step ships the endpoint, but the title-generation call itself
  belongs to step 10.
- **No genre / style edits.** `PATCH` accepts only `title` here, even
  though SPEC.md §11 says title is the only mutable field exposed
  anyway.
- **No skeleton loading states or empty-state polish.** Basic shapes
  only; the polish pass is step 14.

## Architecture

### Server side

#### `GET /api/games`

```
GET /api/games
    │
    ├─ session check (existing middleware)
    ├─ SELECT id, title, thumbnail, updated_at
    │  FROM games
    │  WHERE user_id = ?
    │  ORDER BY updated_at DESC
    │
    └─ reply with array
```

No pagination params. Empty array when the user has zero games.

#### `PATCH /api/games/:id`

```
PATCH /api/games/:id  (Zod-validated body { title: string })
    │
    ├─ session check
    ├─ SELECT id, user_id FROM games WHERE id = ?
    ├─ if not found OR user_id !== session.user.id → 404
    ├─ UPDATE games SET title = ?, updated_at = ? WHERE id = ?
    │
    └─ reply with updated { id, title, updated_at }
```

Title constraints (chosen to match SPEC.md §7's placeholder format —
`prompt.slice(0, 40)` — without imposing a stricter limit than the
generation pipeline itself produces): non-empty after trim, max 80
chars. Trimmed before persist.

#### `POST /api/games/:id/thumbnail`

```
POST /api/games/:id/thumbnail
    (Zod-validated body { thumbnail: string })  // data URL
    │
    ├─ session check
    ├─ ownership check (404 on mismatch)
    ├─ validate format: starts with 'data:image/png;base64,'
    ├─ validate size: decoded payload ≤ ~256 KB (raw string ≤ ~350 KB)
    ├─ UPDATE games SET thumbnail = ?, updated_at = ? WHERE id = ?
    │
    └─ reply 204
```

The size cap is a defensive bound — a captured 320×200 PNG is
typically under 30 KB, but a misbehaving client could try to POST a
multi-megabyte canvas. SQLite `text` columns have no hard cap, but
shipping huge data URLs through TanStack Query's cache and back into
the dashboard list response is wasteful. Rejected uploads return 413.

Module layout:

- `apps/server/src/routes/games.ts` — extended with the three new
  handlers alongside the existing `POST` (step 4),
  `GET /:id` and `DELETE /:id` (step 3).
- `apps/server/src/schemas/games.ts` (or co-located with the route
  file, matching whatever pattern step 3/4 established) — Zod
  schemas for the PATCH and thumbnail bodies.

### Client side

#### Dashboard route

```
/  (TanStack Router file route, auth-gated)
    │
    └─ useQuery({ queryKey: ['games'], queryFn: () => fetch('/api/games') })
         │
         ├─ data.length === 0  → <EmptyState />
         └─ else               → <GameGrid games={data} />
```

`<GameGrid>` renders:

```
[+ New Game]  [Card 1]  [Card 2]  ...  [Card N]
```

Each `<GameCard>`:

- Thumbnail (or a placeholder tile if `thumbnail === null`).
- Title (truncated with ellipsis).
- "Edited <relative time>" using `Intl.RelativeTimeFormat` over
  `updated_at`.
- Click → router `navigate('/game/' + id)`.
- Hover → `⋯` kebab button visible (CSS `group-hover:opacity-100`
  on a default-hidden absolutely-positioned button).
- Kebab click → shadcn `<DropdownMenu>` with **Rename** and
  **Delete** items.

Rename flow:

1. DropdownMenu → click **Rename**.
2. Card swaps title text for an `<input>` (controlled, autofocus,
   text selected).
3. Commit on blur or Enter; cancel on Escape.
4. On commit:
   `useMutation({ mutationFn: PATCH, onMutate: optimisticUpdate,
   onError: rollback, onSettled: invalidate(['games']) })`.

Delete flow:

1. DropdownMenu → click **Delete**.
2. Open shadcn `<Dialog>` with title "Delete this game?" and
   confirm/cancel buttons.
3. Confirm →
   `useMutation({ mutationFn: DELETE,
   onSuccess: invalidate(['games']) })`.

Empty state:

```
┌───────────────────────────────────────┐
│        No games yet.                  │
│  [ Create your first game ]  →/game/new
└───────────────────────────────────────┘
```

Component layout:

- `apps/web/src/routes/index.tsx` — TanStack Router file route for
  `/`. Reads the `['games']` query, branches on empty.
- `apps/web/src/components/dashboard/GameGrid.tsx` — grid container.
- `apps/web/src/components/dashboard/GameCard.tsx` — single card,
  including the hover kebab and DropdownMenu.
- `apps/web/src/components/dashboard/NewGameTile.tsx` — the "+ New
  Game" first card.
- `apps/web/src/components/dashboard/EmptyState.tsx`.
- `apps/web/src/components/dashboard/DeleteGameDialog.tsx` —
  confirm dialog.
- `apps/web/src/components/dashboard/RenameInline.tsx` — inline
  rename input (or inlined into `GameCard`).
- `apps/web/src/lib/api/games.ts` — typed wrappers for
  `listGames()`, `patchGame(id, body)`, `deleteGame(id)`,
  `postThumbnail(id, dataUrl)`.

#### Thumbnail capture in the builder

Triggered from `useStreamedGeneration` (step 4) on the `done`
event, *not* on every `chunk`. Step 4's hook already owns the
state machine; this step adds a post-`done` side effect.

```
on 'done':
    setStatus('idle')
    captureThumbnail(iframeRef.current, gameId)

captureThumbnail(iframeEl, gameId):
    // iframe sandbox is 'allow-scripts' only — no same-origin access
    // to the iframe's document/canvas from the parent. Capture has
    // to run *inside* the iframe and postMessage the data URL out.
    iframeEl.contentWindow.postMessage({ type: 'capture-thumbnail' }, '*')

// in the wrapper script (extends §9 wrapper from step 4):
window.addEventListener('message', (e) => {
  if (e.data?.type !== 'capture-thumbnail') return;
  const c = document.querySelector('canvas');
  if (!c) return;
  parent.postMessage({
    type: 'thumbnail',
    dataUrl: c.toDataURL('image/png'),
  }, '*');
});

// in the builder's existing window 'message' listener:
on { type: 'thumbnail', dataUrl }:
    POST /api/games/:id/thumbnail { thumbnail: dataUrl }
    invalidate(['games'])  // so the dashboard reflects it on next visit
```

The wrapper script lives at `apps/web/src/lib/iframe-wrapper.ts`,
the single canonical location declared by SPEC §9. SPEC §9 enumerates
both the `error`/`unhandledrejection` handlers (added in step 4) and
the `capture-thumbnail` `message` listener as required handlers in
that file; the latter is part of the SPEC §9 contract, not a
step-5-only invention. This step owns implementing the
`capture-thumbnail` listener alongside the existing error handlers.

Capture runs **once** per successful `done`. If the canvas is not
yet visually populated (the game's `init()` may have run but
`render()` not yet ticked), the data URL will be a blank canvas.
After the SSE stream emits `done`, the parent posts
`capture-thumbnail` to the iframe after a short delay (~500ms — long
enough for the first frame to render after `srcdoc` assignment, short
enough that the dashboard thumbnail isn't visibly delayed). SPEC §7's
~2s figure was a heuristic for the original generation flow; the
actual capture happens post-stream-done so the iframe is already
initialized.

Refinement (step 6) will reuse the same capture hook by firing
the same `capture-thumbnail` postMessage after its own `done`.

## Key decisions

### Thumbnails as base64 data URLs in the DB, not object storage

SPEC.md §5 specifies `games.thumbnail` as `text` holding a "base64
PNG data URL or null". This is a deliberate prototype-simplicity
choice:

- One storage backend (SQLite). No S3/MinIO/local-filesystem path
  to manage.
- One auth surface — ownership checks already live on the games
  table; no separate signed-URL or static-route layer.
- The dashboard list endpoint returns the data URL inline; the
  browser caches it as part of the JSON response. No second
  fetch per card.

The cost is row size and JSON payload size on `GET /api/games`.
With the 256 KB per-thumbnail cap and a small per-user library,
the list response stays under ~5 MB even at 20 games. Acceptable
for a prototype.

A future productionization step would move thumbnails to object
storage and keep only a URL on the row; the API shape can stay
identical (the data URL becomes a regular URL string), so client
code is unaffected. Out of scope here.

### No right-click context menu

SPEC.md §12 explicitly: "No right-click menu — that conflicts
with the browser default." Hover-kebab-only. We do not register
`onContextMenu` on cards.

### Thumbnail capture only on successful completion

SPEC.md §12 explicitly: "Thumbnails update only on successful
generation/refinement completion — not during streaming. A game
whose latest refinement is still streaming continues to show its
previous thumbnail."

Mid-stream the iframe is empty (per step 4's decision: `srcdoc`
is assigned only on the SSE `done` event). Even if it weren't,
capturing during streaming would show flashing partial states on
the dashboard. Tying capture to `done` keeps the dashboard's
thumbnail state monotonic with respect to successful runs.

### Capture from inside the iframe via postMessage, not from the parent

The iframe is sandboxed `allow-scripts` only — no
`allow-same-origin` (SPEC.md §9). The parent cannot reach
`iframe.contentDocument.querySelector('canvas')`; cross-origin
iframe access is blocked. The capture has to happen inside the
iframe and ship the data URL out via `postMessage`. This is the
only path consistent with the §9 sandbox.

### shadcn primitives for DropdownMenu and Dialog

SPEC.md §12 lists `DropdownMenu` and `Dialog` in the shadcn
install set. Use them; do not hand-roll. The `DropdownMenu`
matches the kebab pattern naturally; `Dialog` provides the
confirm-delete affordance with focus trapping and Escape-to-close
out of the box.

### Optimistic rename, hard-confirmed delete

Rename is reversible (PATCH back) and the title is a small string
— optimistic update gives an instant UX win. Delete is
destructive and irreversible (hard delete per SPEC.md §11) — no
optimism, only confirm-then-act. Async errors on delete are rare
enough that we don't need to put a row back; we surface a toast
and refetch.

### Ordering by `updated_at desc`

SPEC.md §12 says "last edited timestamp" on the card. The
intuitive order is most-recently-touched first. `updated_at` is
maintained by the PATCH and POST-thumbnail handlers as well as
step 4's stream-completion path; this gives "most recently
worked-on" ordering for free.

### Title length cap of 80 chars

SPEC.md doesn't specify a title cap. The placeholder
(`prompt.slice(0, 40)`) sets a natural floor; doubling gives
breathing room for user-edited titles without unbounded input.
Open question — flagged below.

## Open questions

- **Title length cap.** SPEC.md is silent. Picked 80; revisit if
  the GPT-4.1-mini title generation in step 10 emits longer
  titles. Easy to bump.
- **Thumbnail dimensions.** SPEC.md says "screenshot thumbnails"
  without specifying resolution. The iframe canvas is whatever
  the generated game chose (typically 320×240 to 800×600). We
  capture at the canvas's native resolution and let CSS scale on
  the dashboard. If output sizes vary wildly we may want to
  downscale on the client before POSTing — defer until we see
  real data.
- **Capture delay.** "~2s" in SPEC.md §7 is a heuristic. Picked
  a short `setTimeout` (≤ 500ms) after `done` because the iframe
  has already been assigned `srcdoc` and the game's first
  `render()` should have ticked by the time the parent's
  `done`-handler runs. May need tuning.
- **Concurrent thumbnail POSTs.** If a user generates two games
  back-to-back from two tabs and both finish at similar times,
  both POSTs may race. Each writes to its own row, so the only
  hazard is that one finishes before the other and its
  `updated_at` is briefly older. Acceptable; flagging in case
  it surprises us.
- **Dashboard refresh after thumbnail POST.** Two options: (a)
  invalidate `['games']` so the dashboard refetches on next
  visit, or (b) push the new thumbnail directly into the cache
  via `setQueryData`. Picked (a) for simplicity — the dashboard
  isn't usually visible during generation. Reconsider if
  flashing-thumbnail UX becomes annoying.
- **Empty-string title rejection.** Trim-then-empty PATCH bodies
  return 400. Confirmed via Zod's `.min(1)` after `.trim()`.
  Flagging because some apps allow empty titles ("Untitled");
  here we require non-empty since the placeholder always
  populates one.

## Acceptance criteria

1. **Dashboard list.**
   - Authenticated user with zero games sees the empty state
     with a "Create your first game" CTA pointing at
     `/game/new`.
   - User with one or more games sees the "+ New Game" tile
     followed by their cards in `updated_at desc` order.
   - Each card shows thumbnail (or placeholder), title, and a
     relative-time "Edited" string.
   - Clicking a card navigates to `/game/:id`.
   - Clicking "+ New Game" navigates to `/game/new`.

2. **Rename.**
   - Hovering a card reveals the `⋯` kebab.
   - DropdownMenu shows **Rename** and **Delete**.
   - Click **Rename** → title becomes an input with the current
     title selected.
   - Enter or blur → `PATCH /api/games/:id` fires; UI shows
     the new title immediately (optimistic).
   - Escape → input reverts; no PATCH fires.
   - On server error → title rolls back to its previous value;
     toast surfaces the error.
   - SQLite check: `select title, updated_at from games where id = ?`
     reflects the new title and a fresh `updated_at`.

3. **Delete.**
   - DropdownMenu → **Delete** opens a confirm dialog.
   - Cancel closes the dialog with no effect.
   - Confirm fires `DELETE /api/games/:id`; on success, the
     card disappears from the grid and `messages` rows for
     that game are cascade-deleted (already wired in step 3).
   - Deleting the last game returns the empty state.

4. **Thumbnail capture (initial generation).**
   - User completes a generation at `/game/new`.
   - Within ~1s after the iframe shows the playable game, a
     `POST /api/games/:id/thumbnail` request fires once.
   - Server stores the data URL on the row.
   - Returning to `/` (dashboard) shows the new thumbnail on
     the card.
   - Generating with a Stop click (cancel) does **not** POST a
     thumbnail; the card shows the placeholder tile.

5. **Ownership.**
   - User A's `GET /api/games` does not include user B's games.
   - User A calling
     `PATCH /api/games/<userB-game-id>`,
     `DELETE /api/games/<userB-game-id>`, or
     `POST /api/games/<userB-game-id>/thumbnail`
     receives 404, not 403.

6. **Validation.**
   - `PATCH` with empty / whitespace-only / >80-char title → 400
     with field-level error.
   - `POST .../thumbnail` with a body that isn't a
     `data:image/png;base64,` URL → 400.
   - `POST .../thumbnail` with a payload over the size cap →
     413.

7. **No streaming-time thumbnail writes.**
   - Mid-stream, the dashboard (in another tab) does not show
     a new thumbnail for the in-progress game. Verified by
     refetching `GET /api/games` during the stream — the row's
     `thumbnail` is null (or its previous value, on
     refinement) until `done` fires.
