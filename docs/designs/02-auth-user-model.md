# 02 — Auth + User Model

## Overview

Wire Better Auth into the server with Google and GitHub OAuth providers, extend the user table with the columns needed by later build steps, gate `/api/*` behind sessions, and add the minimum frontend surface required to sign in, see who you are, and sign out. No usage bars, no settings page, no game logic. This step ends when an admin-allowlisted email lands on `/` with `tier='admin'` and a non-allowlisted email lands on `/` with `tier='free'`.

Authoritative source: `docs/SPEC.md` §5, §10, §11, §12, §14, §15, §19 (step 2).

## Goals

- Better Auth wired with Google + GitHub providers, SQLite adapter, ~7-day session cookies (default, no override per §3 / §4 "Sessions").
- `users` table extended with the custom columns from §5 via Better Auth additional fields, included in Better Auth's generated migrations.
- First-sign-in row population via `databaseHooks.user.create.before`: `display_name` from provider (fallback `user-{8 hex}`), `tier` from `ADMIN_EMAILS` allowlist (else `'free'`), initial credit allotment, reset timestamps, `theme` default.
- `/sign-in` page with two buttons (Google, GitHub). Authenticated visitors are redirected to `/`.
- Protected-route guard: unauthenticated visit to a required-auth route redirects to `/sign-in?next=<path>`.
- Top bar on authenticated routes with a user dropdown that exposes "Sign out". No plan badge, no usage bars, no theme toggle, no profile link wired in this step.
- `POST /api/auth/sign-out` clears the session; client hard-navigates to `/sign-in`.
- `GET /api/auth/session` and a thin `GET /api/me` returning the current row (used by the guard + dropdown). `PATCH/DELETE /api/me` and account-link endpoints are out of scope here.
- CORS configured for cross-origin cookies (already done in step 1; this step verifies the auth cookie round-trips).

## Non-goals

- Usage bars in the dropdown (deferred to step 7 per §19).
- Plan badge in the top bar (deferred to step 8).
- Theme toggle wiring (deferred to step 12).
- Settings page, account linking UI, account deletion (deferred to step 12).
- Email/password, email verification, password reset, magic links (out of scope per §2).
- Game routes, ownership checks, credit checks (steps 3+).
- Rate limiting and Pino structured logging polish (step 13). Auth still runs under whatever logging/rate-limiting baseline step 1 left in place.

## Architecture

### Better Auth integration

- Library: `better-auth` with the SQLite adapter, sharing the same Drizzle SQLite handle from `packages/db` so Better Auth's tables (`session`, `account`, `verification`, and the extended `user` table) live in `apps/server/data/arcadeai.db`.
- Config lives in `apps/server/src/plugins/auth.ts` (or `apps/server/src/lib/auth.ts` exporting the configured instance, mounted by a Fastify plugin). Mounted at `/api/auth/*` per §11.
- Providers: `google` and `github`, reading credentials from `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (§15).
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` from env (§15). `BETTER_AUTH_URL=http://localhost:3000` in dev.
- Session cookies: Better Auth defaults (~7-day rolling sessions per §4 "Sessions"), `sameSite: 'lax'`, `secure: false` in dev (§14 CORS).
- CORS already permits `WEB_ORIGIN` with `credentials: true` from step 1; verify Better Auth's `trustedOrigins` includes `WEB_ORIGIN` so OAuth callbacks redirect back to the web app.

### Schema extension

Per §5: the `user` table that Better Auth manages is extended with our app-specific columns by declaring them as additional fields on the auth config. Better Auth includes these in its generated migrations.

Extended fields on `user`:

| Column | Type | Notes |
|---|---|---|
| `display_name` | text not null | OAuth `name` field; `user-{8 hex}` if blank. Not unique. |
| `tier` | text not null | `'free' \| 'creator' \| 'pro' \| 'admin'`. Default `'free'`; admin allowlist overrides at create. |
| `credits_remaining_daily` | integer not null | Initial value from tier's daily cap (§10). |
| `credits_remaining_monthly` | integer not null | Initial value from tier's monthly cap. |
| `daily_reset_at` | integer not null | Unix ms; next UTC midnight at row create. |
| `monthly_reset_at` | integer not null | Unix ms; first of next month UTC at row create. |
| `theme` | text not null default `'dark'` | `'dark' \| 'light' \| 'system'`. |
| `created_at`, `updated_at` | integer not null | Unix ms. |

Better Auth already provides `id` and `email` (§5 maps `email` directly to the OAuth provider's email). We rely on Better Auth's built-in `email`, `emailVerified`, `image`, `createdAt`, `updatedAt` columns where they overlap; the spec's `created_at`/`updated_at` map to Better Auth's. `display_name` is a separate column from Better Auth's `name` (we keep `name` as raw provider data and own `display_name` as the user-mutable field — this matches §5's "user-editable" requirement and §12's settings page using `display_name`).

Better Auth's `session` and `account` tables are unmodified (§5: "managed by the library").

### First-sign-in flow via `databaseHooks`

```
OAuth callback (Google or GitHub)
  → Better Auth resolves provider profile { email, name, ... }
  → databaseHooks.user.create.before fires with the candidate user object
      → compute display_name: provider name if non-empty, else `user-${randomHex(8)}`
      → compute tier: ADMIN_EMAILS.includes(email.toLowerCase()) ? 'admin' : 'free'
      → look up tier's daily/monthly cap from packages/shared/src/plans.ts
        (admin: a sentinel like Number.MAX_SAFE_INTEGER, since admin "bypasses all credit checks" per §10 — actual unlimited behavior lands in step 7; for step 2 we just need a non-null integer)
      → set daily_reset_at = next UTC midnight (ms)
      → set monthly_reset_at = first of next month UTC (ms)
      → set theme = 'dark'
      → return mutated user object
  → Better Auth inserts the user + account rows
  → Session created, cookie set
  → Server redirects to original `callbackURL` (the `next` param if present, else `/`)
```

Subsequent sign-ins skip the `before` hook (no new user created); the existing row is used as-is.

### Protected-route guard (frontend)

- TanStack Router file-based routes. A `beforeLoad` on a `_authed` layout route (or a per-route guard) calls `GET /api/auth/session` (or the cached `/api/me`) via TanStack Query.
- If unauthenticated: `throw redirect({ to: '/sign-in', search: { next: location.href } })`.
- `/sign-in` does the inverse: if already authenticated, `throw redirect({ to: search.next ?? '/' })`.
- `next` is sanitized: only same-origin paths are honored; otherwise fall back to `/`.

### Top bar (this step)

Per §12, the full top bar layout is `[Logo] [Plan Badge] ... [Theme Toggle] [User Icon ▾]`. For step 2 we render only:

- Logo → `/`
- User icon → dropdown with `display_name`, `email`, and "Sign out". No usage bars, no plan badge, no upgrade/settings links wired (§19: "no usage bars yet").

### Sign-out flow

Per §12: dropdown → "Sign out" → `POST /api/auth/sign-out` → on success, hard navigation (`window.location.href = '/sign-in'`) to clear all client state including TanStack Query cache.

## Key decisions

### OAuth-only, no email/password

§2 lists OAuth via Google and GitHub as in-scope; email/password and email verification are explicitly out of scope. Eliminates password storage, reset flows, and email infrastructure for the prototype.

### 7-day session default, no custom override

§4 "Sessions": "Better Auth defaults to ~7-day session cookies. Accepted as-is for the prototype; no custom configuration." We pass nothing to override session lifetime.

### `display_name` fallback rule

§2 and §5: provider's `name` field, falling back to `user-{8 hex chars}` if blank, user-editable, not unique. The 8-hex-char fallback is generated once at row create — it is not regenerated. Subsequent edits happen via `PATCH /api/me` (step 12).

### Admin allowlist via `databaseHooks.user.create.before`

§5 / §10: `ADMIN_EMAILS` env var (comma-separated). Email match → `tier='admin'`. Implemented in the `before` hook so the admin tier is set atomically with row creation, never as a follow-up update. Comparison is case-insensitive (OAuth providers may return mixed-case emails). This is the spec's prescribed mechanism (§5 explicitly names the hook).

### Why the hook over a post-create handler

The hook is the spec's choice (§5, §10) and avoids a window where a row exists with `tier='free'` before being upgraded to `'admin'`. It also keeps the initial credit allotment correct on first read.

### `display_name` as a separate column from Better Auth's `name`

Better Auth's built-in `name` column stores the raw provider-supplied name and is managed by Better Auth on every sign-in (it may be re-synced from the provider). Our `display_name` is a separate user-mutable column initialized from `name` (or `user-{8 hex}` if blank) at first sign-in via `databaseHooks.user.create.before`, and thereafter only changes via `PATCH /api/me` (step 12). On create, both columns are populated; on subsequent provider re-syncs, only `name` changes — `display_name` is preserved. Avoids surprises where a re-sync from the provider would clobber the user's chosen name.

### Admin credit values at row create

§10 says admin "Bypasses all credit checks." Step 7 implements that bypass. For step 2 we still need to write integers to the `credits_remaining_*` columns. We use a large sentinel (`Number.MAX_SAFE_INTEGER`) — never decremented in step 2 (no game routes exist), and the bypass in step 7 means it's never read for decision-making either. Acceptable as a placeholder; flagged as an open question below.

## Resolved decisions

- **Daily cap on paid tiers (was open question 3).** SPEC §10 now explicitly states only Free has an enforced daily cap (500). Creator, Pro, and Admin tiers have no daily cap — the daily counter is decremented for observability but the daily check is skipped. The `users.credits_remaining_daily` column still exists for all tiers; for paid tiers it is initialized equal to the monthly value (informational, never enforced). The canonical `TIER_CREDIT_LIMITS` export in `packages/shared/src/plans.ts` carries a `dailyEnforced` flag so step 7's reset/check logic can branch correctly.
- **Plans config location and shape (was open question 1).** Create a minimal `packages/shared/src/plans.ts` in step 2 exporting `TIER_CREDIT_LIMITS` (canonical name) with shape `{ monthly, daily, dailyEnforced }` per tier; steps 7 and 8 extend the same export rather than introducing parallel `TIER_ALLOTMENTS` / `PLAN_CREDITS` constants.

## Open questions

1. **Admin credit sentinel vs. nullable column.** Using `Number.MAX_SAFE_INTEGER` works but leaks an implementation detail into the DB. Alternative: keep the column non-null and rely on the step-7 bypass to never read it for admins. **Decision for now:** sentinel, deferred to step 7 if it causes issues.
2. **`/api/me` shape in this step.** Step 7 will return usage stats, reset times, linked providers (§11). Step 2 only needs `id`, `email`, `display_name`, `tier` for the dropdown and guard. **Resolution:** ship a minimal shape now; step 7 extends it.
3. **Better Auth's `trustedOrigins` for cross-origin OAuth callback redirects.** Need to confirm the OAuth callback (which lands on `:3000`) can redirect the browser to `:5173` cleanly. **Resolution:** test during pre-flight; Better Auth supports `trustedOrigins: [WEB_ORIGIN]`.

## Acceptance criteria

1. `bun run dev` boots both apps. `GET http://localhost:3000/api/health` still returns `{ ok: true, ... }` (no regression from step 1).
2. Visiting `http://localhost:5173/` while signed out redirects to `/sign-in?next=%2F`.
3. `/sign-in` shows two buttons: "Continue with Google" and "Continue with GitHub".
4. Clicking "Continue with Google" → Google consent → redirects back → lands on `/` (or `next`). User row exists in SQLite with: `email` from Google, `display_name` from Google's `name` (or `user-{8 hex}` if blank), `tier='free'` (assuming email not in `ADMIN_EMAILS`), `credits_remaining_daily=500`, `credits_remaining_monthly=3000`, valid reset timestamps, `theme='dark'`.
5. Same flow with GitHub produces an equivalent user row.
6. Adding the test email to `ADMIN_EMAILS` and signing in (after deleting the user row) results in `tier='admin'`.
7. The top bar on `/` shows the user dropdown trigger; opening it shows `display_name`, `email`, and a "Sign out" item.
8. Clicking "Sign out" → `POST /api/auth/sign-out` returns 200 → browser lands on `/sign-in` → revisiting `/` redirects back to `/sign-in?next=%2F`. Session cookie is cleared.
9. Visiting `/sign-in` while authenticated redirects to `/`.
10. `GET /api/me` returns 401 when unauthenticated and the minimal user shape when authenticated.
11. Cookies survive a full page reload (cross-origin, `credentials: 'include'`, `sameSite: 'lax'`).
