# 05 — Dashboard + game CRUD UI — Plan

Companion to `docs/designs/05-dashboard-game-crud.md`.

## Pre-flight

- [ ] Confirm step 4 deliverables are present and working:
      `POST /api/games` streams via SSE, persists `current_code` on
      `done`, the iframe in `/game/new` renders a playable game, and
      the §9 wrapper script is being injected client-side.
- [ ] Confirm step 3 deliverables remain intact:
      `GET /api/games/:id` and `DELETE /api/games/:id` exist with
      ownership checks returning 404 on mismatch.
- [ ] Confirm the `games` table has the `thumbnail text` column
      (nullable) per SPEC.md §5. No schema change is required in
      this step; if the column is missing for any reason, that's a
      step-3 regression to fix first.
- [ ] Confirm the auth session middleware from step 2 still gates
      `/api/games*`.
- [ ] Confirm shadcn primitives `DropdownMenu`, `Dialog`, `Button`,
      `Input` are installed (SPEC.md §12 install set). Add any that
      are missing via the project's shadcn install command.
- [ ] At least one game row exists for the dev user (manually
      seeded by running a generation in step 4) so the populated
      dashboard path is exercisable end-to-end.
- [ ] `bun run dev` boots cleanly; `/api/health` responds.

## Ordered tasks

### Server

1. **List endpoint.**
   `apps/server/src/routes/games.ts` — add
   `GET /api/games` handler:
   - Read `userId` from session.
   - Drizzle: `db.select({ id, title, thumbnail, updatedAt })
     .from(games).where(eq(games.userId, userId))
     .orderBy(desc(games.updatedAt))`.
   - Return the array as JSON. Empty array on no rows.

2. **PATCH endpoint.**
   `apps/server/src/routes/games.ts` — add
   `PATCH /api/games/:id` handler:
   - Zod schema: `{ title: z.string().trim().min(1).max(80) }`.
     Define alongside step-3/4 schemas (matching whichever pattern
     the codebase adopted).
   - Ownership check: select `userId` for the row; 404 if not
     found or mismatch (SPEC.md §14).
   - `UPDATE games SET title = ?, updated_at = ? WHERE id = ?`
     (timestamps in unix ms per SPEC.md §5).
   - Return `{ id, title, updatedAt }`.

3. **Thumbnail endpoint.**
   `apps/server/src/routes/games.ts` — add
   `POST /api/games/:id/thumbnail` handler:
   - Zod schema: `{ thumbnail: z.string()
     .startsWith('data:image/png;base64,')
     .max(350_000) }` (raw string ceiling to enforce the
     ~256 KB decoded cap from the design doc).
   - On schema failure for size: return 413 instead of 400 (map
     this in the route or via a custom refinement that throws a
     413-typed error).
   - Ownership check: 404 on mismatch.
   - `UPDATE games SET thumbnail = ?, updated_at = ? WHERE id = ?`.
   - Return 204.

4. **Route registration sanity check.** Confirm the three new
   handlers are mounted under `/api/games` and that the existing
   step-3 and step-4 routes (`POST /`, `GET /:id`, `DELETE /:id`)
   still respond. No prefix collisions.

### Client — data layer

5. **Typed API helpers.**
   `apps/web/src/lib/api/games.ts`:
   - `listGames(): Promise<GameSummary[]>` → `GET /api/games`.
   - `patchGame(id, { title }): Promise<GameSummary>` →
     `PATCH /api/games/:id`.
   - `deleteGame(id): Promise<void>` → `DELETE /api/games/:id`
     (already exists from step 3 — ensure a wrapper exists; add
     if missing).
   - `postThumbnail(id, dataUrl): Promise<void>` →
     `POST /api/games/:id/thumbnail`.
   - All use `credentials: 'include'` (SPEC.md §14).

6. **Query keys & types.**
   `apps/web/src/lib/api/games.ts` (or a sibling
   `query-keys.ts`) — export the `['games']` query key constant
   and a `GameSummary` type matching the server's list shape:
   `{ id, title, thumbnail: string | null, updatedAt: number }`.

### Client — dashboard UI

> SPEC.md §12 instructs: "When implementing UI components, **invoke
> the `frontend-design` skill** to ensure production-grade,
> distinctive design quality." Invoke it before building the
> dashboard components in this section so the visual treatment for
> the grid, card, kebab, and dialog match the project's design
> standards.

7. **Dashboard route shell.**
   `apps/web/src/routes/index.tsx` (TanStack Router file route
   for `/`) — auth-gated. Use
   `useQuery({ queryKey: ['games'], queryFn: listGames })`.
   Branch:
   - `isLoading` → minimal placeholder (no skeleton polish; that's
     step 14).
   - `data.length === 0` → `<EmptyState />`.
   - else → `<GameGrid games={data} />`.

8. **`<EmptyState />`.**
   `apps/web/src/components/dashboard/EmptyState.tsx`. Renders
   "No games yet." headline and a "Create your first game" button
   linking to `/game/new`.

9. **`<NewGameTile />`.**
   `apps/web/src/components/dashboard/NewGameTile.tsx`. Card-shaped
   tile with a "+ New Game" label; click navigates to `/game/new`
   via TanStack Router.

10. **`<GameGrid />`.**
    `apps/web/src/components/dashboard/GameGrid.tsx`. Renders the
    `<NewGameTile />` first, then a `<GameCard />` per game in the
    received order. Tailwind grid (responsive — SPEC.md §2 says
    dashboard is responsive even though the builder is not).

11. **`<GameCard />`.**
    `apps/web/src/components/dashboard/GameCard.tsx`. Props:
    `{ game: GameSummary }`. Layout:
    - Thumbnail (`<img src={game.thumbnail} />` if non-null,
      otherwise a placeholder tile — solid color or simple icon).
    - Title text.
    - "Edited <relative time>" via `Intl.RelativeTimeFormat`.
    - Click handler navigates to `/game/${game.id}`.
    - Hover-revealed `⋯` kebab button positioned top-right inside
      the card. Use Tailwind `group-hover:opacity-100` on a
      default `opacity-0` button so it doesn't steal pointer
      events when not hovered.
    - `onContextMenu` is **not** wired (SPEC.md §12 explicitly
      excludes right-click).

12. **Kebab dropdown.**
    Inside `<GameCard />` (or a small `<GameCardMenu />`
    sibling) — wire the kebab button as the trigger for shadcn
    `<DropdownMenu>` with two items:
    - **Rename** → toggles inline-edit mode in the card.
    - **Delete** → opens the confirm dialog.
    Stop event propagation on menu interactions so they don't
    trigger the card's own click navigation.

13. **Inline rename.**
    Inside `<GameCard />` — when rename mode is active, swap the
    title text for a controlled `<Input>` (autofocus, select all
    on focus). Handlers:
    - Enter or blur → call `useMutation(patchGame)` with
      optimistic update via
      `queryClient.setQueryData(['games'], ...)` and rollback in
      `onError`. `onSettled` invalidates `['games']`.
    - Escape → exit rename mode without firing PATCH.
    - Empty / whitespace title on commit → exit rename mode
      without firing (treat as cancel) so the user isn't
      bounced into a 400 error from a typo.

14. **Delete confirm dialog.**
    `apps/web/src/components/dashboard/DeleteGameDialog.tsx`.
    Built on shadcn `<Dialog>`. Title "Delete this game?" body
    "This can't be undone." Buttons: Cancel (closes), Delete
    (destructive variant). Confirm fires
    `useMutation(deleteGame)`; `onSuccess` invalidates
    `['games']`. Surface mutation errors via a toast (Sonner
    is in the SPEC.md §12 install set).

### Client — thumbnail capture

15. **Add the `capture-thumbnail` listener to the wrapper script.**
    `apps/web/src/lib/iframe-wrapper.ts` — the canonical wrapper
    file per SPEC §9. Add a `message` listener (declared as a
    required handler in SPEC §9) that responds to
    `{ type: 'capture-thumbnail' }` by reading the first
    `<canvas>` in the document and posting back
    `{ type: 'thumbnail', dataUrl }` via
    `parent.postMessage`. Keep the step-4 error handlers
    (`error` / `unhandledrejection`, also declared in SPEC §9)
    intact; they are unchanged.

16. **Capture trigger in the streaming hook.**
    `apps/web/src/hooks/useStreamedGeneration.ts` (from step 4) —
    on the SSE `done` event, schedule a
    `setTimeout(captureThumbnail, ≤500ms)` call that pulls
    the iframe ref (provided by the consuming component) and
    `postMessage`s `{ type: 'capture-thumbnail' }` to its
    `contentWindow`. Capture is a no-op if `gameId` is falsy
    or the iframe ref is detached.

    Refactor consideration: the hook may need an iframe ref
    handed in via parameters or an `attachIframe(ref)` method
    so the `done` handler can target the right window. Keep
    the changes minimal — the hook keeps owning the state
    machine; the consumer passes the ref.

17. **Parent-side `thumbnail` message handler.**
    Where step 4 already mounts a `window` `message` listener
    (likely in `<GameIframe />` or the builder shell), add a
    branch for `{ type: 'thumbnail', dataUrl }`: call
    `postThumbnail(gameId, dataUrl)`, then
    `queryClient.invalidateQueries({ queryKey: ['games'] })`.
    Swallow errors with a console warning — a failed thumbnail
    upload is not user-facing critical, and the next successful
    completion will retry.

18. **Cancellation path.**
    Confirm that aborting via the Stop button (step 4) does
    NOT take the `done` branch in the hook, and therefore does
    NOT trigger `captureThumbnail`. Verify by code inspection;
    the existing `status === 'streaming' → 'idle'` transition
    on abort already lives in step 4. Add an explicit early-
    return guard inside the capture handler if the status has
    moved away from `'idle'` by the time the timeout fires.

## Verification steps

Run with `bun run dev` and a real `ANTHROPIC_API_KEY`.

1. **Empty dashboard.**
   - Sign in with a fresh user (or delete all games from the
     existing user's library via DevTools to reset).
   - Navigate to `/`.
   - Observe: `<EmptyState />` with "Create your first game"
     CTA. No grid.

2. **Create → see in dashboard with thumbnail.**
   - Click the empty-state CTA → `/game/new`.
   - Submit a prompt; let the stream complete.
   - Observe: iframe renders the playable game (step 4
     behavior unchanged).
   - Observe in DevTools network panel: a single
     `POST /api/games/:id/thumbnail` request fires shortly
     after `done`. 204 response.
   - Navigate back to `/`.
   - Observe: the new card appears with the captured
     thumbnail, the placeholder title, and "Edited just now".
   - SQLite check: `select id, title, length(thumbnail)
     from games` shows a non-null thumbnail data URL.

3. **Rename inline.**
   - On the dashboard, hover a card → `⋯` kebab appears.
   - Click kebab → DropdownMenu opens.
   - Click **Rename** → title becomes an input with selected
     text.
   - Type a new title; press Enter.
   - Observe: title updates instantly (optimistic), card
     re-orders if `updated_at` change moved it.
   - Reload the page; new title persists.
   - SQLite check: `select title from games where id = ?`
     matches.
   - Edge case: open rename, type whitespace only, press
     Enter → input closes silently, no PATCH fires (no 400
     toast).
   - Edge case: open rename, press Escape → input reverts,
     no PATCH fires.

4. **Delete with confirm.**
   - Hover a card, kebab → **Delete** → dialog opens.
   - Cancel → dialog closes; card unchanged.
   - Reopen → confirm Delete → card disappears from the grid.
   - Reload; card stays gone.
   - SQLite check: `select count(*) from games where id = ?`
     returns 0; `select count(*) from messages where
     game_id = ?` also returns 0 (cascade from step 3).

5. **Empty state after deleting last game.**
   - From a single-game state, delete the last game.
   - Observe: grid disappears; `<EmptyState />` re-renders.
   - SQLite check: `select count(*) from games where
     user_id = ?` is 0.

6. **Ownership 404s.**
   - In a separate browser session, sign in as user B.
   - With user B's session, attempt
     `PATCH /api/games/<userA-game-id>`,
     `DELETE /api/games/<userA-game-id>`, and
     `POST /api/games/<userA-game-id>/thumbnail` via curl or
     DevTools fetch.
   - Each returns 404, not 403 (SPEC.md §14).
   - User B's `GET /api/games` does not include user A's rows.

7. **Validation rejects.**
   - `PATCH` with body `{ "title": "" }` → 400.
   - `PATCH` with body `{ "title": "   " }` → 400 (trims to
     empty).
   - `PATCH` with an 81-char title → 400.
   - `POST .../thumbnail` with body
     `{ "thumbnail": "not-a-data-url" }` → 400.
   - `POST .../thumbnail` with a payload over the size cap
     (synthesize a long base64 string) → 413.

8. **No mid-stream thumbnail.**
   - Open `/` in tab A; open `/game/new` in tab B and start a
     long generation.
   - In tab A, manually invalidate or refetch `['games']`
     while tab B is still streaming.
   - Observe: the in-progress game does not appear with a new
     thumbnail. (For initial generation, the row may not even
     have any prior thumbnail, so the placeholder tile is
     shown until `done` completes and the post-`done` POST
     lands.)

9. **Cancellation does not POST a thumbnail.**
   - Start a generation; click **Stop** mid-stream.
   - Observe: no `POST /api/games/:id/thumbnail` request in
     the network panel.
   - SQLite check: `select thumbnail from games where id = ?`
     is null.

10. **Build & lint.** Per `AGENTS.md` pre-commit gate:
    - `bun run build` (typecheck both workspaces).
    - `bun run check` (Biome).
    - Both pass before committing.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — Server endpoints

After the **Server** tasks complete (list, rename/PATCH, delete, thumbnail upload handlers) and the pre-commit gate passes:

```
feat(api): add list/rename/delete/thumbnail endpoints
```

Includes: `GET /api/games`, `PATCH /api/games/:id`, `DELETE /api/games/:id`, `POST /api/games/:id/thumbnail` route handlers in `apps/server`.

### Checkpoint 2 — Dashboard UI + thumbnail capture

After the **Client — data layer**, **Client — dashboard UI**, and **Client — thumbnail capture** tasks complete and the pre-commit gate passes:

```
feat(dashboard): build game grid with kebab actions and thumbnail capture
```

Includes: dashboard route, game-grid component, kebab-menu actions (rename / delete), TanStack Query hooks, and the iframe thumbnail capture utility.

## Rollback notes

- All work in this step is additive on the server side. The three
  new handlers (`GET /api/games`, `PATCH /api/games/:id`,
  `POST /api/games/:id/thumbnail`) can be removed without affecting
  step 3 or step 4 routes.
- No schema migrations are introduced. The `thumbnail` column
  already exists per step 3 / SPEC.md §5; this step only writes
  to it. Rolling back leaves any captured thumbnails in place
  but unread — they are harmless.
- Client-side: deleting `apps/web/src/routes/index.tsx` (or
  reverting it to whatever step 4 left there) removes the
  dashboard surface. The `apps/web/src/components/dashboard/`
  directory and `apps/web/src/lib/api/games.ts` are new and
  fully isolated; deleting them removes the dependency.
- The iframe wrapper change is the only edit to a step-4 file.
  Reverting `iframe-wrapper.ts` to its step-4 form (error
  handlers only, no `capture-thumbnail` listener) restores the
  prior behavior. The streaming hook's `done` branch can drop
  its `captureThumbnail` call without other consequence.
- Ownership-check, auth, and concurrency machinery are not
  touched. No effect on step 4's streaming path.
- Feature flag is unnecessary — these endpoints and routes
  simply don't exist in earlier steps; the dashboard route
  reverts to whatever placeholder step 2 / step 4 had.
