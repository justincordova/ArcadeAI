# 12 — Settings Page + Theme Toggle

## Overview

Step 12 ships the user-facing settings surface defined in SPEC §11
and §12, plus the dark/light/system theme system from SPEC §5 and
§12. Three concrete deliverables:

1. **`/settings` route** — display name editing with auto-save on
   blur and an inline status indicator ("Saving..." → "Saved ✓" →
   fades after 1.5s); read-only email; connected accounts list with
   Connect buttons on unlinked providers and a last-provider guard
   that blocks disconnecting the only linked account; current-plan
   row that links to `/pricing`; delete-account button gated by a
   confirm dialog that hard-deletes the user, all their games, and
   all linked OAuth records (SPEC §11, §12).
2. **Backend additions** — `PATCH /api/me` accepting
   `{ display_name?, theme? }` and returning the updated user;
   `DELETE /api/me` cascading to `games`, `messages`, `usage_log`,
   Better Auth's `session` + `account` tables; `/api/me` extended
   to include `linkedProviders: ('google'|'github')[]` derived from
   Better Auth's `account` table; account link endpoints exposed
   through Better Auth's existing link API (SPEC §11).
3. **Theme system** — a `ThemeProvider` mounted above the router
   that reads `localStorage` synchronously on first paint, applies
   the DOM class before React hydrates, reconciles to
   `users.theme` once `/api/me` resolves, and uses an optimistic
   TanStack Query mutation on toggle (DOM + localStorage updated
   immediately, `PATCH /api/me { theme }` fires in the background,
   reverts both layers + shows a toast on PATCH failure). The
   theme toggle button lives in the top bar next to the plan badge
   from step 8 and cycles `dark → light → system` (SPEC §12).

The settings page is the first surface where the user mutates their
own row. The theme system is the first piece of state that has to
work for unauthenticated routes (`/sign-in`, `/pricing` for logged-
out users), which is why the localStorage mirror is mandatory rather
than a nice-to-have.

## Goals

- New route `/settings` (auth-required, redirects to
  `/sign-in?next=/settings` on miss) per SPEC §12.
- Display-name field bound to a TanStack Query mutation triggered
  on blur. Auto-save shows the inline status indicator: idle →
  "Saving..." → "Saved ✓" → fades after 1.5s. No explicit Save
  button (SPEC §12).
- Email rendered read-only from `/api/me`. No edit affordance —
  email is OAuth-sourced (SPEC §2).
- Connected accounts component reads `linkedProviders` from
  `/api/me`. Each provider row shows a checkmark/Connect-button
  toggle. The only linked provider's disconnect affordance is
  hidden client-side; the server enforces the same guard
  defensively (SPEC §12: "cannot disconnect the last linked
  provider").
- Connect button hits Better Auth's account-link endpoint
  (`POST /api/auth/link/google` or `/github` per SPEC §11). On
  success, invalidate the `/api/me` query so `linkedProviders`
  refreshes.
- Current plan row reads `tier` from `/api/me` (already cached
  from step 7 / step 8) and links to `/pricing`.
- Delete-account button opens a shadcn `Dialog` with explicit copy
  ("Permanently delete your account and all games. This cannot be
  undone.") and a destructive confirm. Confirm fires
  `DELETE /api/me`; on success, the client signs out (clears the
  TanStack Query cache via hard navigation) and lands on
  `/sign-in` (SPEC §12).
- `PATCH /api/me` handler accepts a partial body
  `{ display_name?: string, theme?: 'dark'|'light'|'system' }`.
  Validates with Zod, persists, returns the same shape as
  `GET /api/me` (SPEC §11). 400 on empty body or invalid fields.
- `DELETE /api/me` handler runs in a single transaction:
  - Delete `games` for `user_id` (cascades to `messages` per SPEC
    §5 schema).
  - Delete `usage_log` rows for `user_id` (FK has `on delete
    cascade` already; documented for completeness).
  - Delete Better Auth `session` and `account` rows for the user
    (SPEC §11: "all linked OAuth accounts").
  - Delete the `users` row.
  - Sign the session out.
- `/api/me` GET extended to include
  `linkedProviders: ('google'|'github')[]` derived from a join
  against Better Auth's `account` table (one row per provider per
  user — SPEC §5 note).
- `ThemeProvider` mounted above the TanStack Router root.
  - Synchronous read of `localStorage.theme` on module load (before
    React paints), applies `dark`|`light` class to
    `document.documentElement` immediately. `system` resolves
    against `window.matchMedia('(prefers-color-scheme: dark)')`.
  - On `/api/me` settle, reconcile: if `users.theme` differs from
    the localStorage value, update localStorage + DOM to match the
    DB value (DB is source of truth for authenticated users).
  - Exposes `useTheme()` returning `{ theme, setTheme }` where
    `setTheme` runs the optimistic mutation.
- Theme toggle button (`ThemeToggle.tsx`) in the top bar from step
  8 (sun/moon icon, third state for system). Click cycles
  `dark → light → system → dark`. Uses `useTheme().setTheme`.
- Light-mode color tokens defined in `apps/web/src/styles/` (or
  wherever step 1 / step 8 placed Tailwind v4 theme tokens).
  Cream background, dark text, muted neon accents (SPEC §12 —
  full-saturation neon on light is unreadable). **Invoke the
  `frontend-design` skill** when defining these tokens (SPEC §12).
- Top-bar plan badge stays unchanged (SPEC §12 layout: logo |
  plan badge | … | theme toggle | user icon).

## Non-goals

- **No avatar upload.** Out of scope per SPEC §2 (no asset
  generation, no upload pipeline) and not listed in SPEC §12's
  settings page contents. The user dropdown shows the display
  name only.
- **No email change.** Email is sourced from the OAuth provider
  and is read-only by design (SPEC §2: "no email/password";
  SPEC §12: "Email (read-only, from OAuth provider)"). Changing
  email would require re-verification flows that don't exist.
- **No password change.** No password exists — OAuth-only auth
  (SPEC §2).
- **No notification preferences.** Not listed in SPEC §12. No
  outbound email exists in the prototype anyway (SPEC §2).
- **No display-name uniqueness.** SPEC §5 explicitly: "Not unique."
  Server does not check or enforce uniqueness on `PATCH`.
- **No undo for account deletion.** Hard delete by design (SPEC
  §12 "hard deletes user + all games + all linked OAuth records").
  No soft-delete column, no restore window.
- **No save button on display name.** Auto-save on blur is the
  contract (SPEC §12). Adding a button would conflict with the
  inline status indicator design.
- **No per-tab theme.** Theme is global per browser via
  localStorage and per user via DB. Cross-tab sync is best-effort
  via the `storage` event (see Open questions); not a SPEC
  requirement.
- **No theme animation.** DOM class flip is instant. Animating
  background/text color across an entire app is jank-prone and
  adds no functional value.
- **No display-name length limit beyond a sane Zod cap.** SPEC
  has no constraint; we'll allow 1–80 chars defensively.

## Architecture

### `/settings` route

`apps/web/src/routes/settings.tsx` — TanStack Router file-based
route under the `_authed` layout (or whatever guard pattern step 2
established). Layout:

```
┌─ Settings ─────────────────────────────────┐
│  Display name                              │
│  [text input — auto-save on blur]   [⏳]   │
│                                            │
│  Email                                     │
│  user@example.com  (read-only)             │
│                                            │
│  Connected accounts                        │
│   Google   ✓ Linked                        │
│   GitHub   [Connect]                       │
│                                            │
│  Current plan                              │
│  Free  →  Manage in /pricing               │
│                                            │
│  ─── Danger zone ───                       │
│  [Delete account]                          │
└────────────────────────────────────────────┘
```

Sections render as plain stacked blocks separated by shadcn
`Separator`. shadcn primitives used: `Input`, `Label`, `Button`,
`Dialog`, `Separator`, `Sonner` (already installed per SPEC §12).
No `Card` wrapper — the page is a single column.

### Display-name auto-save

Component: `SettingsDisplayName.tsx`.

- Local state `value` mirrors the user's `display_name` from
  `/api/me`. Initialized when the query resolves; updated on each
  keystroke.
- TanStack Query `useMutation` calls
  `patchMe({ display_name: value })` on blur if `value !==
  initialValue && value.trim().length > 0`.
- Status state machine (a small `useReducer` or three booleans is
  fine):
  - `idle` — nothing rendered next to the input.
  - `saving` — render "Saving..." badge.
  - `saved` — render "Saved ✓"; after 1500ms `setTimeout` →
    `idle`. Cancel pending timer if a new save starts.
  - `error` — render "Couldn't save" + retry affordance; reverts
    `value` to the last known good and shows a Sonner toast.
- On mutation success, `queryClient.setQueryData(['me'], …)` with
  the response (the handler returns the same shape as
  `GET /api/me`), avoiding a refetch.
- Empty-trimmed save attempt is a no-op (the auto-save only fires
  when value is non-empty); the user can't blank out their name.
- Hitting Enter blurs the input (manual save trigger by keyboard).

### Connected accounts

Component: `SettingsConnectedAccounts.tsx`.

- Reads `linkedProviders` from `/api/me` (TanStack Query cache
  key `['me']`). Two fixed rows: Google, GitHub.
- For each provider, render:
  - Linked: muted "✓ Linked" badge. **No disconnect button.**
    SPEC §12 disallows disconnecting the last provider; rather
    than render-then-hide depending on count, we omit the
    disconnect affordance entirely in this step. Disconnecting
    one of multiple providers is a future feature (see Open
    questions).
  - Unlinked: a `Connect` button that hits the Better Auth
    link endpoint (`POST /api/auth/link/{provider}`, SPEC §11).
    Better Auth handles the redirect to the provider's OAuth
    consent and returns to a callback that adds an `account`
    row. On callback success, the client invalidates the
    `['me']` query so `linkedProviders` updates.
- The last-provider guard is therefore implicit on the client
  (no disconnect UI at all). The server's defensive guard sits
  inside Better Auth (its account-unlink endpoint, if/when
  exposed in step 12+, must reject the last linked row). Since
  this step doesn't expose unlink, the server-side guard is a
  forward-looking safeguard documented here but not implemented:
  see Open questions.

### Delete account

Component: `SettingsDangerZone.tsx`.

- Single button: `Delete account` (destructive variant).
- shadcn `Dialog` with:
  - Title: "Delete account?"
  - Body: "This permanently deletes your account, all your games,
    and all linked sign-in providers. This cannot be undone."
  - Two buttons: `Cancel` (default) and `Delete` (destructive).
- Confirm fires `useMutation(deleteMe)` → `DELETE /api/me`.
- On 200:
  - `queryClient.clear()`.
  - Hard navigate to `/sign-in` (full reload to ensure no stale
    state). SPEC §12 sign-out flow uses hard navigation; mirror
    it here.
- On error: keep dialog open, show Sonner toast.

### Backend: `PATCH /api/me`

`apps/server/src/routes/me.ts` (extending step 2's GET handler).

- Auth: existing session middleware (SPEC §14).
- Body Zod schema:
  ```ts
  z.object({
    display_name: z.string().trim().min(1).max(80).optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
  }).refine(d => d.display_name !== undefined || d.theme !== undefined,
    { message: 'At least one field required' });
  ```
- `UPDATE users SET <provided fields>, updated_at = ? WHERE id = ?`.
- Recompute and return the same shape as `GET /api/me` (display_name,
  theme, tier, credit fields, linkedProviders, etc.). Reuse the
  GET handler's serializer.

### Backend: `DELETE /api/me`

- Auth: existing session middleware.
- Single transaction:
  1. `DELETE FROM games WHERE user_id = ?` (FK cascades to
     `messages` per SPEC §5).
  2. `DELETE FROM usage_log WHERE user_id = ?` (FK cascade
     already; explicit for clarity).
  3. `DELETE FROM session WHERE user_id = ?` (Better Auth table).
  4. `DELETE FROM account WHERE user_id = ?` (Better Auth table —
     "all linked OAuth records" per SPEC §12).
  5. `DELETE FROM user WHERE id = ?` (Better Auth's user table,
     which our `users` extends).
  6. Invalidate the session cookie (Better Auth `signOut`
     equivalent on the server).
- Returns 204. Client handles cleanup (clear cache, hard nav).
- Wrap in `db.transaction` (Drizzle) to ensure atomicity. If any
  step fails, the whole delete rolls back and the route returns
  500; the client shows a toast.

### Backend: `/api/me` extension — `linkedProviders`

The existing GET handler is extended:
```ts
const accounts = await db.select({ providerId: account.providerId })
  .from(account).where(eq(account.userId, userId));
const linkedProviders = accounts
  .map(a => a.providerId)
  .filter((p): p is 'google' | 'github' => p === 'google' || p === 'github');
```

(`account.providerId` is Better Auth's column for the provider
slug.) The serializer returns `linkedProviders` alongside the
existing fields.

### Backend: account-link endpoints

`POST /api/auth/link/google` and `/github` are Better Auth
endpoints (SPEC §11). They are mounted by the existing Better Auth
plugin from step 2. Step 12 does not add new server code for
linking — only exposes the buttons that hit them.

### Theme system

`apps/web/src/lib/theme.ts` exports:
- `type Theme = 'dark' | 'light' | 'system'`
- `getStoredTheme(): Theme` — synchronous `localStorage.theme`
  read with `'dark'` default (SPEC §5: default `'dark'`).
- `applyTheme(theme: Theme): void` — resolves `system` against
  `matchMedia('(prefers-color-scheme: dark)')`, sets/removes the
  `'dark'` class on `document.documentElement` (Tailwind v4 dark
  variant trigger), writes through to `localStorage.theme`.

`apps/web/src/main.tsx` (the entry that mounts React) calls
`applyTheme(getStoredTheme())` **synchronously before
`ReactDOM.createRoot`** so the first paint is correct (SPEC §12:
"on first paint, read from localStorage and apply immediately
(synchronous)"). Optionally a tiny inline `<script>` in
`index.html` does the same before the JS bundle even loads — see
Open questions.

`ThemeProvider.tsx` lives in `apps/web/src/components/theme-
provider.tsx`. It:
- Holds a React `useState<Theme>` initialized from
  `getStoredTheme()`.
- Subscribes to `matchMedia('(prefers-color-scheme: dark)')` so
  `system`-mode users follow OS changes live.
- Subscribes to the `storage` event so a theme change in another
  tab propagates here. (Best-effort — see Non-goals; the impl is
  one effect.)
- Watches `useQuery(['me'])`. On settle, if
  `me.theme !== currentTheme`, calls `applyTheme(me.theme)` and
  updates state. This is the **reconcile** step (SPEC §12 read
  path).
- Exposes `useTheme()` returning `{ theme, setTheme }`.

`setTheme(next: Theme)` is the optimistic write (SPEC §12 write
path):
1. Capture `prev = theme`.
2. `applyTheme(next)` — DOM + localStorage updated immediately.
3. Update React state to `next`.
4. `mutate({ theme: next })` against `PATCH /api/me { theme }`.
5. On mutation error: `applyTheme(prev)`, set state to `prev`,
   `toast.error('Failed to save theme preference.')` (SPEC §12).

The mutation also `setQueryData(['me'], (prev) => ({ ...prev,
theme: next }))` on optimistic phase, with `onError` rolling it
back. Standard TanStack Query optimistic-update pattern.

### Theme toggle button

`apps/web/src/components/theme-toggle.tsx`:
- Reads `theme` from `useTheme()`.
- Renders an icon button: sun for `light`, moon for `dark`,
  monitor (or split sun/moon) for `system`. Tooltip shows
  "Theme: dark / light / system" (current state).
- Click → `setTheme(next)` where `next` cycles
  `dark → light → system → dark`.
- Mounted in the existing top-bar component between the plan
  badge (step 8) and the user icon (step 2). SPEC §12 layout:
  `[Logo] [Plan Badge] … [Theme Toggle] [User Icon ▾]`.
- Visible on every authenticated route. For unauthenticated
  routes that have a top bar (`/pricing` for logged-out users
  per SPEC §12), the toggle still works against localStorage
  only — the optimistic mutation no-ops (or is skipped) when
  `me` is null.

### Light-mode tokens

Tailwind v4 uses CSS custom properties under `@theme`. Step 1 set
up the dark baseline. Step 12 adds the light-mode counterparts in
the same theme file (or a `:root.light` selector / a `:root` +
`:root.dark` pair, whichever pattern step 1 chose).

Rough palette (final values resolved by the `frontend-design`
skill):
- `--background`: cream (e.g. `#fbf6e8`-ish).
- `--foreground`: near-black (`#1b1810`-ish).
- Accent neons (green/orange/yellow/purple from SPEC §12 plan
  badge palette) get muted, lower-saturation, higher-contrast
  variants for the light theme. SPEC §12 explicitly: "muted neon
  accents (full-saturation neon on light is unreadable)."
- Plan badge variants get a `light:` override so colors remain
  readable with the existing border-style.

The tokens flow through every existing component automatically;
no per-component edits.

### Data flow summary

```
First paint:
  index.html / main.tsx  →  applyTheme(getStoredTheme())
                            (DOM class + localStorage written)
React mounts:
  ThemeProvider state = getStoredTheme()
TanStack Query:
  useQuery(['me']) settles
ThemeProvider effect:
  if me.theme !== state → applyTheme(me.theme), setState

User toggles:
  ThemeToggle onClick
    → setTheme(next)
        → applyTheme(next)        (sync, DOM + localStorage)
        → setState(next)          (sync, React)
        → mutate({ theme: next })  (background)
            onError:
              applyTheme(prev), setState(prev), toast()

Display-name save:
  Input onBlur
    → if changed, mutate({ display_name })
        status: idle → saving → saved (1.5s) → idle
        onError: revert, toast

Account delete:
  Button click
    → Dialog open
    → Confirm
        → mutate(deleteMe)
        → success: queryClient.clear(), hard nav /sign-in
        → error: toast, dialog stays open
```

## Key decisions

- **Auto-save on blur, no Save button.** SPEC §12 mandates this
  pattern. Why it's right: a single editable field with a clear
  status indicator removes a click and matches modern norms
  (Notion, Linear, Stripe Dashboard). A Save button on a one-
  field form is friction theater. The status indicator
  ("Saving..." → "Saved ✓") provides the same confirmation
  signal a button-press would.
- **Optimistic theme write.** SPEC §12 write path is explicit:
  DOM update first, PATCH in the background, revert on failure.
  Why optimistic: a theme toggle that lags a network round-trip
  feels broken. Theme is purely visual and trivially reversible
  on failure — exactly the case where optimistic UI is correct.
- **localStorage mirror.** SPEC §5 + §12: theme is also stored in
  localStorage. Why we can't skip it: unauthenticated routes
  (`/sign-in`, logged-out `/pricing`) need a theme too, and the
  first paint of *any* route must apply the correct theme before
  React mounts (otherwise users see a dark-to-light flash on
  every page load). DB-only would require an awaited fetch
  before render, which kills perceived performance.
- **Synchronous read on init.** SPEC §12: "read from localStorage
  and apply immediately (synchronous)." The cleanest place is the
  entry script (`main.tsx`) before `createRoot`. An even-cleaner
  variant is a tiny inline `<script>` in `index.html` that runs
  before any JS bundle loads, eliminating any chance of an FOUC
  even if the bundle is delayed. We adopt main.tsx for now and
  note the inline-script optimization as a follow-up — see Open
  questions.
- **Reconcile from DB after `/api/me` settles.** The DB is source
  of truth for authenticated users (a user signing in on a new
  device should see the theme they last selected). The localStorage
  copy is a render-priority cache, not the canonical store. If
  they disagree, DB wins — but only after the page has already
  painted from localStorage.
- **No disconnect button at all.** SPEC §12 says "cannot
  disconnect the last linked provider." Implementing partial
  disconnect (when ≥2 providers are linked) requires a server
  unlink endpoint (Better Auth's API) plus careful handling of
  which provider's session is currently active. Defer to a
  future iteration. For now, Connect-only is sufficient and
  trivially correct under the SPEC constraint.
- **`linkedProviders` is derived, not stored.** Better Auth's
  `account` table already encodes the linkage one-row-per-
  provider. Adding a denormalized column on `users` would drift.
  The GET handler joins on read.
- **Hard delete, no soft delete.** SPEC §12: "hard deletes user +
  all games + all linked OAuth records." Soft delete adds a
  `deleted_at` column, query predicates everywhere, and a
  restore UI we don't have. Cascading FK deletes from SPEC §5
  do the work in one transaction.
- **Single transaction for delete.** Atomicity matters: a
  partially-deleted user (e.g. `users` row gone but `account`
  rows orphaned) is hard to recover from manually. SQLite
  transactions are cheap; wrap the whole sequence.
- **Theme toggle cycles three states, not a binary switch.**
  SPEC §12: "cycles dark → light → system." `system` is
  meaningfully different from a fixed theme — it follows the OS
  preference, which is what many users actually want. A binary
  switch would lose that.
- **PATCH `/api/me` returns the full user shape.** Mirrors step
  7 / step 8 patterns where mutating endpoints return the same
  shape `GET /api/me` returns, so the client can
  `setQueryData(['me'], …)` without a refetch.
- **Defensive `display_name` trim + min-1.** SPEC §5 has no
  uniqueness constraint, but allowing whitespace-only or empty
  strings would render as nothing in the user dropdown. Zod's
  `.trim().min(1)` handles both.
- **No display name in the URL or shareable surface.** SPEC §2
  doesn't expose user profiles publicly; collisions on
  `display_name` are harmless.

## Open questions

- **Inline `<script>` in `index.html` for FOUC prevention.**
  Putting the `applyTheme(getStoredTheme())` call in a synchronous
  inline script in `index.html`'s `<head>` runs before the JS
  bundle even downloads, eliminating any flash even on slow
  networks. The current plan runs it in `main.tsx` which is
  fast but theoretically blockable. Decision deferred to plan;
  default is `main.tsx`-only, escalate to inline if any FOUC
  is observed during verification.
- **Server-side last-provider guard.** This step doesn't expose
  an unlink endpoint, so there's nothing to guard yet. When a
  future step adds disconnect, the guard belongs in the unlink
  handler (and also in Better Auth's plugin config if it
  supports it). Document here for forward reference.
- **Cross-tab theme sync via the `storage` event.** Adding a
  one-line listener that re-applies theme when localStorage
  changes in another tab is cheap. Not a SPEC requirement but
  arguably expected behavior. Default position: include it,
  one effect, no test surface beyond manual verification.
- **Pre-fill `display_name` validation.** Should the server
  reject `display_name` that matches `user-{8 hex}` exactly
  (the auto-generated default)? No — users should be allowed
  to keep the default, and SPEC has no such rule. Confirm
  during execute.
- **Display-name length cap.** SPEC has none. We default to 80
  chars. If product feedback says shorter, change in one place.
- **Toast text on theme PATCH failure.** SPEC §12 specifies
  "Failed to save theme preference." Use that exact string.
- **Confirm-dialog typing requirement.** Some products require
  typing the username to confirm deletion. SPEC §12 just says
  "confirm dialog." Default position: a single Delete button
  with destructive styling is sufficient at MVP; revisit if
  any user accidentally deletes during dogfooding.
- **Settings route on mobile.** SPEC §2 only requires builder
  to be desktop-only; dashboard and pricing are responsive.
  Settings is a vertical stack of plain blocks and is trivially
  responsive — no special handling needed.

## Acceptance criteria

1. Visiting `/settings` while signed in renders display name,
   email, connected accounts, current plan, and Delete account
   sections.
2. Visiting `/settings` while signed out redirects to
   `/sign-in?next=/settings`.
3. Editing the display name and tabbing away (blur) shows
   "Saving..." next to the input, then "Saved ✓" within a
   reasonable wait, which fades after ~1.5s. The new value
   persists across reload.
4. PATCH failure (force a 500 by killing the server mid-save)
   reverts the input value to the last known good and shows a
   Sonner toast. No infinite "Saving..." state.
5. Email is rendered read-only; the input is disabled or
   non-editable text.
6. With only Google linked, the Google row shows "✓ Linked" and
   the GitHub row shows a `Connect` button. Clicking Connect
   begins the GitHub OAuth flow.
7. After GitHub linking completes, `/settings` reflects both
   providers as Linked without a hard reload (the `['me']`
   query is invalidated and refetched).
8. With both providers linked, neither row shows a disconnect
   button (last-provider guard implicit; no unlink path
   exposed).
9. Current-plan row shows the user's tier and links to
   `/pricing`.
10. Clicking Delete account opens a confirm dialog. Confirming
    fires `DELETE /api/me`. On success, the TanStack Query
    cache is cleared, the user is hard-navigated to
    `/sign-in`, and re-signing in creates a fresh `users` row
    (the old one and its games are gone).
11. After delete, querying SQLite confirms zero remaining rows
    in `games`, `messages`, `usage_log`, `session`, `account`,
    and `user` for the deleted user id.
12. `/api/me` returns a `linkedProviders` array. The order is
    deterministic enough for the UI to render Google before
    GitHub (the UI sorts client-side; the server doesn't need
    to).
13. On first paint of any route (signed in or out), the theme
    matches `localStorage.theme`. With localStorage cleared,
    the default is `dark` (SPEC §5).
14. Clicking the theme toggle in the top bar cycles
    `dark → light → system → dark`. Each click instantly
    flips the DOM (`.dark` class on `<html>`) and updates
    localStorage.
15. After toggling theme on an authenticated route and
    reloading, the same theme is applied (DB persists across
    reload).
16. Signing in on a fresh browser (empty localStorage) with a
    user whose `users.theme = 'light'` reconciles to light
    after `/api/me` resolves: first paint is dark (default),
    immediately followed by a flip to light. (Acceptable
    flicker — see Open questions for the inline-script
    optimization.)
17. Forcing `PATCH /api/me { theme }` to fail (e.g. block the
    request in DevTools) reverts the DOM and localStorage to
    the previous theme and shows a Sonner toast: "Failed to
    save theme preference."
18. Light mode is legible: the cream background + dark text +
    muted neon accents pass a quick contrast check across the
    dashboard, pricing page, builder, and settings pages.
    (Verification is human-eye, not WCAG-automated, in this
    step.)
19. The plan badge in the top bar continues to function (step
    8 unaffected). The theme toggle sits between the plan
    badge and the user icon per SPEC §12 layout.
20. Deleting the user account does not leave orphan rows in
    Better Auth's `session` or `account` tables.

(End of file)
