# 12 — Settings Page + Theme Toggle — Implementation Plan

Implements the design in `docs/designs/12-settings-theme.md`.
Grounded in SPEC §2, §5, §11, §12, §14.

## Pre-flight

Confirm the following before starting. Stop and resolve if
anything is missing.

- **Step 2 complete.** Better Auth is wired with Google + GitHub
  providers. The `users` table has the `display_name`, `tier`,
  `theme` (default `'dark'`) columns per SPEC §5 / step 2 design.
  `databaseHooks.user.create.before` populates them on first
  sign-in. `GET /api/me` exists and returns at minimum
  `{ id, email, display_name, tier, theme }`. The protected-
  route guard (`_authed` layout or equivalent) redirects
  unauthenticated users to `/sign-in?next=...`. The top-bar
  user dropdown is mounted on authenticated routes.
- **Step 7 complete.** `/api/me` extended to include
  `creditsRemainingDaily`, `creditsRemainingMonthly`, reset
  timestamps. `usage_log` table exists. The mutating
  endpoints (where present) return the same shape as
  `GET /api/me` so optimistic updates work via
  `setQueryData(['me'], …)`.
- **Step 8 complete.** Plan badge is mounted in the top bar
  (SPEC §12 layout). The badge has a stable slot the theme
  toggle can sit next to. The pricing page exists at
  `/pricing` so the settings page can link to it.
- **`PATCH /api/me` does not yet exist** (or only stubs
  `{ display_name }`). Step 12 owns the full handler.
- **`DELETE /api/me` does not yet exist.** Step 12 owns it.
- **Better Auth `account` table is populated.** Verify by
  signing in once with each provider on a test account and
  confirming two rows in `account` for that user. The
  `linkedProviders` extension to `/api/me` joins on this
  table.
- **shadcn primitives.** `Dialog`, `Input`, `Label`, `Button`,
  `Separator`, `Sonner` should already be installed (SPEC §12
  list). Install any missing primitive at the top of the step
  via `bunx shadcn@latest add <name>` rather than mid-task.
- **Theme tokens.** Confirm Tailwind v4 is set up with `@theme`
  in step 1 and that the dark variant is wired (likely via the
  `.dark` class on `<html>`). Light tokens get added in this
  step.

If step 8's plan badge has not landed yet, the theme toggle has
no anchor in the top bar; coordinate with step 8 or scope the
toggle into a temporary slot that step 8 will subsume.

## Ordered tasks

### 1. Backend: `/api/me` `linkedProviders` extension

In `apps/server/src/routes/me.ts` (the existing GET handler from
step 2 / step 7):

- Import Better Auth's `account` table from the db schema (or
  from Better Auth's exported schema, whichever pattern step 2
  established).
- After loading the user, query:
  ```ts
  const accountRows = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId));
  const linkedProviders = accountRows
    .map(r => r.providerId)
    .filter((p): p is 'google' | 'github' =>
      p === 'google' || p === 'github');
  ```
- Add `linkedProviders` to the response shape. Update the
  shared response type in `packages/shared/src/types.ts` (or
  wherever `MeResponse` lives — match step 7's type).
- Verify with `curl -i --cookie ... http://localhost:3000/api/me`
  on a user with both providers linked: `linkedProviders`
  should be `['google', 'github']` (order not guaranteed).

### 2. Backend: `PATCH /api/me`

Same file. Add the route handler.

- **Body Zod schema:**
  ```ts
  const patchMeBody = z.object({
    display_name: z.string().trim().min(1).max(80).optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
  }).refine(
    d => d.display_name !== undefined || d.theme !== undefined,
    { message: 'At least one field required' },
  );
  ```
  Validation failure → 400 (existing Fastify+Zod plugin).
- Use the existing session middleware (SPEC §14 — auth gating
  is global on `/api/*` minus auth/health).
- Build a partial update object from validated body, plus
  `updated_at = Date.now()`.
- `await db.update(users).set(...).where(eq(users.id, userId))`.
- Reuse the GET handler's serializer to recompute and return
  the full `MeResponse` shape (including the just-updated
  `linkedProviders`). Factor the serializer into a small
  `loadMe(userId)` helper if not already factored.
- 200 on success.
- A short comment cites SPEC §11.

### 3. Backend: `DELETE /api/me`

Same file. New handler.

- Auth via existing middleware.
- Wrap in `db.transaction(async (tx) => { ... })`:
  1. `tx.delete(games).where(eq(games.userId, userId))` — FK
     cascades into `messages` per SPEC §5.
  2. `tx.delete(usageLog).where(eq(usageLog.userId, userId))` —
     explicit even though the FK has cascade, for clarity in
     reading the handler.
  3. `tx.delete(session).where(eq(session.userId, userId))`.
  4. `tx.delete(account).where(eq(account.userId, userId))`.
  5. `tx.delete(users).where(eq(users.id, userId))`.
- After the transaction, invalidate the session cookie. Use
  Better Auth's server-side `signOut` helper (or whatever
  mechanism step 2 wired for the `POST /api/auth/sign-out`
  route) to ensure the cookie is cleared and the session row
  is gone.
- Return 204.
- On any error inside the transaction, Drizzle rolls back; the
  handler returns 500. The client surfaces a toast.
- Cite SPEC §11 + §12 in a top comment.

### 4. Backend: link endpoints sanity check

Better Auth exposes `POST /api/auth/link/google` and
`POST /api/auth/link/github` (SPEC §11). These should be live
already from step 2's plugin mount.

- Smoke-test with a curl POST against each (signed-in cookie
  required). Each should redirect to the provider's OAuth
  consent.
- If either is not mounted, update the Better Auth plugin
  config in `apps/server/src/plugins/auth.ts` to enable the
  account-linking feature (Better Auth opts-in via
  `accountLinking: { enabled: true, ... }` in newer versions).
  No new server route handlers required either way.

### 5. Frontend API helpers

`apps/web/src/lib/api.ts` (or wherever step 2 / step 5 / step 7
put the typed fetch helpers):

- `patchMe(body: { display_name?: string; theme?: Theme }):
  Promise<MeResponse>` — `PATCH /api/me`.
- `deleteMe(): Promise<void>` — `DELETE /api/me`.
- `linkProviderUrl(provider: 'google' | 'github'): string` —
  returns the URL the Connect button hits. Most likely the
  link endpoint requires a POST with redirect-on-success; if
  Better Auth's pattern requires a hidden form or an `action`
  attribute, build a small `linkProvider(provider)` function
  that submits the form. Mirror whatever `signIn` helper from
  step 2 does.

### 6. Frontend: `theme.ts` core helpers

Create `apps/web/src/lib/theme.ts`:

```ts
export type Theme = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'theme';

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system'
    ? v
    : 'dark'; // SPEC §5: default 'dark'
}

export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  window.localStorage.setItem(STORAGE_KEY, theme);
}
```

Pure module. No React dependencies. SSR-safe `typeof window`
checks even though Vite is client-only — defensive.

### 7. Frontend: synchronous theme application on init

In `apps/web/src/main.tsx` (the React entry point), call
`applyTheme(getStoredTheme())` **before** `ReactDOM.createRoot`:

```ts
import { applyTheme, getStoredTheme } from './lib/theme';
applyTheme(getStoredTheme());

const root = ReactDOM.createRoot(...);
root.render(...);
```

This satisfies SPEC §12's "on first paint, read from
localStorage and apply immediately (synchronous)" requirement.

If verification observes any FOUC, escalate to an inline
`<script>` in `index.html` (open question in the design doc).

### 8. Frontend: `ThemeProvider`

Create `apps/web/src/components/theme-provider.tsx`:

- React context exposing `{ theme, setTheme }`.
- Internal `useState<Theme>` initialized to `getStoredTheme()`.
- `useEffect` that subscribes to `matchMedia('(prefers-color-
  scheme: dark)')`'s `change` event. Only meaningful when
  `theme === 'system'`. On change, call `applyTheme('system')`
  to re-evaluate. (Don't change the stored Theme — just
  re-apply the resolved class.)
- `useEffect` that subscribes to the `storage` event so
  cross-tab `theme` changes propagate. On a `theme` key
  change, set state from the new value and `applyTheme(new)`.
- `useEffect` that watches `useQuery(['me'])`'s `data?.theme`.
  When `data` is defined and `data.theme !== state`, call
  `applyTheme(data.theme)` and update state. **Reconcile
  step** per SPEC §12 read path.
- `setTheme(next)` performs the optimistic mutation:
  ```ts
  const setTheme = (next: Theme) => {
    const prev = theme;
    applyTheme(next);
    setState(next);
    queryClient.setQueryData(['me'], (m: MeResponse | undefined) =>
      m ? { ...m, theme: next } : m);
    patchMeMutation.mutate(
      { theme: next },
      {
        onError: () => {
          applyTheme(prev);
          setState(prev);
          queryClient.setQueryData(['me'], (m: MeResponse | undefined) =>
            m ? { ...m, theme: prev } : m);
          toast.error('Failed to save theme preference.');
        },
      },
    );
  };
  ```
  Cite SPEC §12 write path in a comment.
- `patchMeMutation` is created with `useMutation({ mutationFn:
  (body) => patchMe(body) })`. Skip the network call entirely
  if the user is unauthenticated (`me` is undefined / 401).
  In that case `setTheme` only writes localStorage + DOM —
  unauthenticated routes still get a working toggle.
- Mount the provider above the TanStack Router root in
  `main.tsx` (inside the `QueryClientProvider`).

### 9. Frontend: `useTheme` hook

In the same file or a sibling:

```ts
export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
```

### 10. Frontend: `ThemeToggle` component

Create `apps/web/src/components/theme-toggle.tsx`:

- Reads `{ theme, setTheme }` from `useTheme()`.
- Cycles `dark → light → system → dark`:
  ```ts
  const NEXT: Record<Theme, Theme> = {
    dark: 'light',
    light: 'system',
    system: 'dark',
  };
  ```
- Renders a shadcn `Button` (icon variant) with an icon that
  reflects the current state:
  - `dark`: moon
  - `light`: sun
  - `system`: monitor (or split sun/moon)
- shadcn `Tooltip` wrapping the button: "Theme: <current>".
- `onClick={() => setTheme(NEXT[theme])}`.
- Use `lucide-react` for icons (already a shadcn dep).

### 11. Top-bar slot

In the existing top-bar component (mounted on authenticated
routes from step 2; logged-out variant from step 8):

- Insert `<ThemeToggle />` between the plan badge (step 8) and
  the user icon (step 2). SPEC §12 layout:
  `[Logo] [Plan Badge] … [Theme Toggle] [User Icon ▾]`.
- For the logged-out top bar (visible on `/pricing` per SPEC
  §12), include `<ThemeToggle />` as well — the toggle works
  against localStorage even without a session.

### 12. Light-mode color tokens — invoke `frontend-design` skill

**Use the `frontend-design` skill** for the light-mode token
work. The skill is responsible for distinctive design quality
per SPEC §12.

Inputs to give the skill:
- The dark theme tokens currently in
  `apps/web/src/styles/...` (or wherever step 1 placed
  Tailwind v4 `@theme` declarations).
- The plan-badge color references from SPEC §12 (Free=green
  outline, Creator=orange, Pro=yellow, Admin=purple).
- SPEC §12 constraint: cream background, dark text, muted
  neon accents (full-saturation neon on light is unreadable).
- SPEC §17: aesthetic quality matters; this is a user-facing
  surface every authenticated session sees.

Expected output:
- Light-mode CSS custom properties added under the existing
  `@theme` block (or a `:root.light` selector / equivalent
  Tailwind v4 pattern in use).
- Plan-badge `light:` overrides in the badge component if its
  colors are inline rather than tokenized.
- A quick visual pass on `/`, `/pricing`, `/game/:id`, and
  `/settings` in light mode to confirm legibility.

Do not hand-tune neon hex values without the skill — SPEC §12
calls out that this is the skill's job.

### 13. Frontend: `/settings` route shell

Create `apps/web/src/routes/settings.tsx` (or
`_authed/settings.tsx` matching the file-based router pattern
from step 2):

- Protected by the existing auth guard (redirects to
  `/sign-in?next=/settings` on miss, SPEC §12).
- Layout component renders five vertically stacked sections
  separated by shadcn `Separator`:
  1. Display name
  2. Email (read-only)
  3. Connected accounts
  4. Current plan
  5. Danger zone (Delete account)
- Each section is its own component to keep the route file
  thin.

### 14. Display name auto-save component

Create `apps/web/src/components/settings/display-name.tsx`:

- Reads `me.display_name` from `useQuery(['me'])`.
- Local state `value` initialized from `me.display_name` once
  the query resolves; updated on every keystroke.
- Status state machine via `useReducer` or three flags:
  - `idle`, `saving`, `saved`, `error`.
- `useMutation(patchMe)` with:
  - `onMutate`: status → `saving`. Cancel any pending
    "saved → idle" timer.
  - `onSuccess`: status → `saved`; `setQueryData(['me'], …)`
    with response. Schedule a 1500ms timer → status `idle`.
  - `onError`: status → `error`; revert `value` to
    `me.display_name`; `toast.error('Couldn\'t save display
    name.')`.
- `onBlur`:
  ```ts
  if (value.trim() === me.display_name) return; // no-op
  if (value.trim().length === 0) {
    setValue(me.display_name); // empty disallowed
    return;
  }
  mutation.mutate({ display_name: value.trim() });
  ```
- `onKeyDown` Enter → `inputRef.current?.blur()` (manual
  trigger).
- Status indicator rendered next to the input (right-aligned
  small text, color-coded):
  - `saving`: muted gray "Saving..."
  - `saved`: green "Saved ✓"
  - `error`: red "Couldn't save"
- shadcn `Label` + `Input`. Single line.

### 15. Email read-only block

Create `apps/web/src/components/settings/email.tsx`:

- Reads `me.email` from `useQuery(['me'])`.
- Renders a `Label` + a styled span (or a disabled `Input`)
  with `me.email` and a small muted note: "Sourced from your
  sign-in provider."

### 16. Connected accounts component

Create `apps/web/src/components/settings/connected-accounts.tsx`:

- Reads `me.linkedProviders` from `useQuery(['me'])`.
- Renders two fixed rows: Google, GitHub. Static order.
- Per row:
  - If `linkedProviders.includes(provider)`: muted "✓ Linked"
    badge.
  - Else: a `Connect` `Button` that hits the link endpoint.
- Connect handler: `linkProvider(provider)` from
  `apps/web/src/lib/api.ts`. After the Better Auth callback
  returns, the user lands back on `/settings` (configure the
  callback's `next` param if Better Auth supports it; if not,
  the page reloads naturally and the `['me']` query refetches
  on mount). Either way, after refetch, the row flips to
  Linked.
- No disconnect button. Cite SPEC §12 in a top comment ("cannot
  disconnect the last linked provider — disconnect not
  exposed in this step").

### 17. Current plan row

Create `apps/web/src/components/settings/current-plan.tsx`:

- Reads `me.tier` from `useQuery(['me'])`.
- Renders the tier name + a `Link` to `/pricing` ("Manage in
  Pricing →"). Uses the existing tier-display label / color
  utility from step 8 if one exists; otherwise plain text is
  fine (the source of truth for badge styling stays in step
  8's plan-badge component).

### 18. Delete account dialog

Create `apps/web/src/components/settings/danger-zone.tsx`:

- Single destructive `Button`: "Delete account".
- Click opens a shadcn `Dialog`:
  - Title: "Delete account?"
  - Body: "This permanently deletes your account, all your
    games, and all linked sign-in providers. This cannot be
    undone."
  - Footer: `Cancel` (default) and `Delete` (destructive
    variant).
- `Delete` click fires `useMutation(deleteMe)`:
  - `onSuccess`: `queryClient.clear()`, then
    `window.location.assign('/sign-in')` (hard nav per SPEC
    §12 sign-out flow).
  - `onError`: toast "Failed to delete account."; dialog
    stays open.

### 19. `linkedProviders` types

In `packages/shared/src/types.ts` (or wherever step 2 / step 7
defined `MeResponse`):

- Extend the type:
  ```ts
  export type LinkedProvider = 'google' | 'github';
  export interface MeResponse {
    // ...existing fields...
    linkedProviders: LinkedProvider[];
  }
  ```
- Update any consumers that previously typed `me` without
  this field (TS will surface them).

Consolidate the final `MeResponse` shape in
`packages/shared/src/types.ts`. Step 7 already extended this file
with credit fields. Step 12 adds the final fields
(`linkedProviders: Array<'google' | 'github'>` plus `theme`). Step 02
doesn't actually touch `types.ts`. Confirm there's a single canonical
type definition, not duplicates.

This is the single canonical shape:

```ts
export type MeResponse = {
  id: string;
  email: string;
  display_name: string;
  tier: 'free' | 'creator' | 'pro' | 'admin';
  theme: 'dark' | 'light' | 'system';
  creditsRemainingDaily: number;
  creditsRemainingMonthly: number;
  dailyResetAt: number;
  monthlyResetAt: number;
  linkedProviders: ('google' | 'github')[];
};
```

Step 12 verifies all earlier handler implementations return this
complete object.

### 20. Wire `useTheme().setTheme` to PATCH cleanly

In `ThemeProvider`'s mutation, ensure:
- The mutation is keyed off the same `queryClient` as the
  user dropdown / settings (single global QueryClient from
  step 1).
- The mutation does **not** invalidate `['me']` — that would
  cause a refetch race against the optimistic update. We
  already `setQueryData` on the response.
- The `MeResponse` returned by `PATCH /api/me` is used to
  reconcile any other fields the server might have refreshed
  (`updated_at`, etc.).

## Verification steps

Run each manually after the code is in place. Dev server
running, two test users (one with one provider, one with
both), at least one game in the library for each.

1. **Display name auto-save (happy path).**
   - Visit `/settings`.
   - Edit the display name input to a new value, then Tab
     out (blur).
   - Expect: "Saving..." appears next to the input → "Saved
     ✓" within ~500ms → fades after 1.5s.
   - Reload the page; the new value persists.
   - Verify in DB: `SELECT display_name FROM user WHERE id =
     ?` shows the new value.
2. **Display name auto-save (failure path).**
   - In DevTools, throttle / block `PATCH /api/me`. Edit and
     blur.
   - Expect: status flips to `error`, the input reverts to
     the prior value, and a Sonner toast appears.
   - Restore network. Editing again succeeds.
3. **Empty display name guard.**
   - Clear the input entirely and blur.
   - Expect: input reverts to the last-saved value; no PATCH
     fires; no error toast.
4. **Email read-only.**
   - Confirm the email field is non-editable and matches the
     OAuth-sourced address.
5. **Connect a second provider.**
   - Sign in with only Google linked. Visit `/settings`. The
     GitHub row shows `Connect`.
   - Click `Connect` → GitHub OAuth → return to `/settings`.
   - Expect: both rows now show `✓ Linked`. No reload
     required (the `['me']` query refetched on mount or via
     invalidation).
   - Verify in DB: `SELECT providerId FROM account WHERE
     userId = ?` shows two rows.
6. **Last-provider guard (UI).**
   - With both providers linked, confirm there is no
     disconnect button on either row. The UI exposes Connect
     only on unlinked providers.
7. **Delete account.**
   - Click Delete account → dialog opens. Click Cancel →
     dialog closes, no change.
   - Click Delete account → dialog → Delete.
   - Expect: hard nav to `/sign-in`. The previous user's
     cookie is gone.
   - Verify in DB:
     ```sql
     SELECT COUNT(*) FROM games  WHERE user_id = ?;       -- 0
     SELECT COUNT(*) FROM messages WHERE game_id IN (...); -- 0
     SELECT COUNT(*) FROM usage_log WHERE user_id = ?;     -- 0
     SELECT COUNT(*) FROM session WHERE userId = ?;        -- 0
     SELECT COUNT(*) FROM account WHERE userId = ?;        -- 0
     SELECT COUNT(*) FROM user WHERE id = ?;               -- 0
     ```
   - Re-sign in with the same OAuth account → a fresh user
     row is created with default `display_name` and
     `tier='free'` (or admin if email matches `ADMIN_EMAILS`).
8. **Theme toggle: instant flip.**
   - Sign in. Click the theme toggle.
   - Expect: DOM class on `<html>` flips immediately (no
     visible network wait). `localStorage.theme` updates.
   - DevTools network tab shows the `PATCH /api/me { theme }`
     fire after the DOM update, not before.
9. **Theme toggle: cycle.**
   - Click three more times. Expect cycle:
     `dark → light → system → dark` (or starting from
     wherever the user is now). Each click flips the DOM
     instantly.
10. **Theme persists across reload.**
    - Toggle to light. Reload `/settings`.
    - Expect: page paints in light immediately (no dark→light
      flash on a fast machine; minor flicker acceptable on
      slow networks).
11. **Theme reconciles from DB on fresh browser.**
    - Set `users.theme = 'light'` for the test user
      directly: `UPDATE user SET theme = 'light' WHERE id =
      ?`.
    - Open a fresh incognito window with empty localStorage.
    - Sign in. Land on `/`.
    - Expect: first paint is dark (default), then a flip to
      light once `/api/me` resolves. localStorage now has
      `theme=light`.
12. **Theme toggle: PATCH failure → revert + toast.**
    - In DevTools, block `PATCH /api/me`.
    - Click the theme toggle.
    - Expect: DOM flips immediately, then within ~1s reverts
      back, and a Sonner toast appears: "Failed to save
      theme preference."
    - localStorage also reverted.
13. **Theme system mode follows OS.**
    - Set theme to `system` via the toggle.
    - In OS settings, switch between dark and light.
    - Expect: the page follows in real time (the
      `matchMedia` listener triggers `applyTheme('system')`).
14. **Theme on unauthenticated routes.**
    - Sign out. On `/sign-in`, click the theme toggle.
    - Expect: DOM flips, localStorage updates, no PATCH
      attempted (or PATCH returns 401 silently — should not
      surface a toast since `me` is undefined; verify in
      DevTools that the mutation isn't fired when
      unauthenticated).
15. **Plan link.**
    - Click the "Manage in Pricing" link.
    - Expect: navigates to `/pricing`. Step 8 is unaffected.
16. **No regression on top bar.**
    - Confirm logo, plan badge, theme toggle, user icon all
      render in order on `/`, `/game/:id`, `/pricing`,
      `/settings`. Click each (where clickable) and confirm
      step-2 / step-8 behavior is unchanged.
17. **Light-mode legibility.**
    - In light mode, walk through `/`, `/pricing`, builder,
      and `/settings`. Confirm text is legible against the
      cream background and the plan-badge / accent colors
      pop without harshness.
    - This is a human-eye check; flag anything obviously
      hard to read for the `frontend-design` skill to
      revisit.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — Server `/api/me` patch/delete

After the server tasks complete (`PATCH /api/me`, `DELETE /api/me`, link-endpoints sanity check, consolidated me-response shape) and the pre-commit gate passes:

```
feat(api): add patch/delete /api/me and consolidated me-response shape
```

Includes: `PATCH /api/me`, `DELETE /api/me`, the consolidated me-response shape, and the link-endpoints sanity wiring.

### Checkpoint 2 — Settings page + theme

After the frontend tasks complete (theme core + provider + toggle, light-mode tokens, settings route, display-name auto-save, email block, connected accounts, current plan row, delete-account dialog, top-bar slot, `linkedProviders` types, theme PATCH wiring) and the pre-commit gate passes:

```
feat(settings): build settings page with theme and link mgmt
```

Includes: `apps/web/src/lib/theme.ts`, `theme-provider.tsx`, `theme-toggle.tsx`, the settings route, settings sub-components (display name, email, connected accounts, current plan, delete account), top-bar slot, and frontend API helpers.

## Rollback notes

- **Mostly additive.** New files:
  - `apps/web/src/lib/theme.ts`
  - `apps/web/src/components/theme-provider.tsx`
  - `apps/web/src/components/theme-toggle.tsx`
  - `apps/web/src/routes/settings.tsx` (or
    `_authed/settings.tsx`)
  - `apps/web/src/components/settings/display-name.tsx`
  - `apps/web/src/components/settings/email.tsx`
  - `apps/web/src/components/settings/connected-accounts.tsx`
  - `apps/web/src/components/settings/current-plan.tsx`
  - `apps/web/src/components/settings/danger-zone.tsx`
- **Modified files (small):**
  - `apps/server/src/routes/me.ts` — adds PATCH and DELETE
    handlers; extends GET to include `linkedProviders`.
  - `apps/web/src/main.tsx` — adds the synchronous
    `applyTheme(getStoredTheme())` call and mounts
    `ThemeProvider`.
  - The top-bar component — inserts `<ThemeToggle />` in
    the SPEC §12 layout slot.
  - `packages/shared/src/types.ts` — extends `MeResponse`
    with `linkedProviders`.
  - The Tailwind v4 theme file — adds light-mode tokens.
- **Schema:** no new tables, no new columns. The `theme`
  column already exists on `users` (step 2). The
  `users.display_name` column already exists (step 2).
  `usage_log`, `account`, `session`, `games`, `messages`
  tables are pre-existing. Rollback requires no migration.
- **Reverting the server alone** removes `PATCH /api/me`
  and `DELETE /api/me`. The frontend will see 404s on
  display-name save and account delete; theme toggle
  will revert + toast on every click. Unpleasant but
  recoverable.
- **Reverting the client alone** leaves PATCH/DELETE
  endpoints reachable but unused. Existing GET callers
  see the new `linkedProviders` field, which they
  ignore.
- **Reverting the theme tokens** alone breaks light-
  mode rendering but not dark mode (the default). The
  toggle still works; the visuals just look broken in
  light mode. Not a data-loss path.
- **Account deletion is irreversible** (no soft-delete
  by design). If a user reports accidental deletion,
  there is no recovery path inside the prototype. Document
  this in the confirm dialog copy.
- **Partial rollback of the connected-accounts UI** is
  safe — the link endpoints are Better Auth's, owned by
  step 2 / its plugin config, not by step 12.

(End of file)
