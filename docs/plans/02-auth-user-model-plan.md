# 02 — Auth + User Model — Implementation Plan

Companion to `docs/designs/02-auth-user-model.md`. Grounds in `docs/SPEC.md` §5, §10, §11, §12, §14, §15, §19 (step 2).

## Pre-flight

### 1. Google OAuth app

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application.
2. Authorized JavaScript origins: `http://localhost:5173`, `http://localhost:3000`.
3. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` (per §11).
4. Copy `Client ID` and `Client Secret` into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Configure OAuth consent screen as "External", testing mode, add the developer's email as a test user. Scopes: `openid`, `email`, `profile`.

### 2. GitHub OAuth app

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Homepage URL: `http://localhost:5173`.
3. Authorization callback URL: `http://localhost:3000/api/auth/callback/github` (per §11).
4. Generate a client secret. Copy into `.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

### 3. Auth secret

```
openssl rand -base64 32
```

Set as `BETTER_AUTH_SECRET` in `.env`. Set `BETTER_AUTH_URL=http://localhost:3000`.

### 4. Admin allowlist

In `.env`: `ADMIN_EMAILS=<your test email>`. Confirm `.env` is gitignored (already from step 1). Update `.env.example` to include all six new variables (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ADMIN_EMAILS`) — the spec §15 already lists them, so the example file should already match; verify.

### 5. Dependencies

In `apps/server`:
- `better-auth` (latest stable)
- Confirm `@fastify/cors` is already installed from step 1.

In `apps/web`:
- `better-auth` (its React client export, if used for typed session hooks) — optional; we can call `/api/auth/*` directly via `fetch` if preferred. Decide during task 5.

In `packages/db`:
- No new deps. Better Auth uses the existing Drizzle/SQLite handle.

## Ordered tasks

### Task 1 — Plans config stub (`packages/shared/src/plans.ts`)

Create a minimal plans module that step 2 can read for initial credit allotment. **This file is the canonical home for tier credit data.** Steps 7 (usage/reset logic) and 8 (pricing display) extend this same export rather than redeclaring it — do not introduce parallel constants like `TIER_ALLOTMENTS` or `PLAN_CREDITS` in later steps.

```ts
export type Tier = 'free' | 'creator' | 'pro' | 'admin';

// Canonical export. Shape accommodates step 7 (allotments + enforcement flag)
// and step 8 (display values for pricing). Per SPEC §10: only Free has an
// enforced daily cap; paid tiers' daily counter is decremented for
// observability but the daily check is skipped.
export const TIER_CREDIT_LIMITS: Record<Tier, {
  monthly: number;
  daily: number;
  dailyEnforced: boolean;
}> = {
  free:    { monthly: 3000,                     daily: 500,                       dailyEnforced: true  },
  creator: { monthly: 20000,                    daily: 20000,                     dailyEnforced: false },
  pro:     { monthly: 50000,                    daily: 50000,                     dailyEnforced: false },
  admin:   { monthly: Number.MAX_SAFE_INTEGER,  daily: Number.MAX_SAFE_INTEGER,   dailyEnforced: false },
} as const;
```

Free caps per §10. For paid tiers (Creator/Pro/Admin) `daily` is initialized equal to `monthly` since the daily counter is informational only — `dailyEnforced: false` signals to step 7 that the daily check is skipped. Admin uses sentinels.

Export from `packages/shared/src/index.ts`.

### Task 2 — Better Auth schema additional fields + admin tier helper (`apps/server/src/lib/auth.ts`)

Define the auth instance with:
- SQLite adapter pointing at the existing Drizzle DB handle from `packages/db`.
- `socialProviders.google` and `socialProviders.github` configured from env.
- `trustedOrigins: [process.env.WEB_ORIGIN ?? 'http://localhost:5173']`.
- `secret: process.env.BETTER_AUTH_SECRET`, `baseURL: process.env.BETTER_AUTH_URL`.
- `user.additionalFields` declaring `display_name`, `tier`, `credits_remaining_daily`, `credits_remaining_monthly`, `daily_reset_at`, `monthly_reset_at`, `theme` (per §5 / design doc schema table).
- `databaseHooks.user.create.before`: see Task 3.

Helper utilities (same file or a sibling `apps/server/src/lib/auth-helpers.ts`):
- `nextUtcMidnightMs(now: number): number`
- `firstOfNextMonthUtcMs(now: number): number`
- `randomHex(bytes: number): string` (crypto.randomBytes-based)
- `isAdminEmail(email: string): boolean` reading `ADMIN_EMAILS` (split on `,`, trim, lowercase compare)

### Task 3 — `databaseHooks.user.create.before` (in `apps/server/src/lib/auth.ts`)

```
hook input: candidate user with email, name (from provider), image, ...
  display_name = (name && name.trim()) || `user-${randomHex(4)}`  // 4 bytes = 8 hex chars
  tier = isAdminEmail(email) ? 'admin' : 'free'
  caps = TIER_CREDIT_LIMITS[tier]
  now = Date.now()
  return {
    ...user,
    display_name,
    tier,
    // Note: for paid tiers `caps.daily === caps.monthly` and `dailyEnforced: false`.
    // The daily counter is decremented for observability in step 7 but not enforced.
    credits_remaining_daily: caps.daily,
    credits_remaining_monthly: caps.monthly,
    daily_reset_at: nextUtcMidnightMs(now),
    monthly_reset_at: firstOfNextMonthUtcMs(now),
    theme: 'dark',
  }
```

### Task 4 — Mount Better Auth on Fastify (`apps/server/src/plugins/auth.ts`)

A Fastify plugin that:
- Imports the configured `auth` instance.
- Registers a catch-all route at `/api/auth/*` that delegates to `auth.handler` (Better Auth's standard `node:http`/`Request`-style handler — adapt with Fastify's `request.raw`/`reply.raw` or `reply.send` as needed).
- Decorates the Fastify instance with `getSession(request)` returning the Better Auth session (or null) for use by the auth-gating preHandler in Task 5.

Register the plugin in `apps/server/src/index.ts` before any route registrations.

### Task 5 — Auth gating preHandler + `/api/me` (`apps/server/src/plugins/require-auth.ts` + `apps/server/src/routes/me.ts`)

Per §14: Better Auth session middleware on all `/api/*` except `/api/auth/*` and `/api/health`.

- Add a Fastify preHandler hook that runs on routes matching `/api/*` except `/api/auth/*` and `/api/health`. If `getSession(request)` returns null, reply 401.
- New route `GET /api/me` (auth-gated) returning `{ id, email, display_name, tier }`. The full shape from §11 lands in step 7.

### Task 6 — Generate + run migrations (`packages/db` + `apps/server`)

Better Auth's CLI generates migrations that include the additional fields.

- Run `bunx @better-auth/cli generate --config apps/server/src/lib/auth.ts` (exact command per Better Auth docs at implementation time) to produce migration SQL.
- Place the generated migration in `packages/db/src/migrations/`.
- Run migrations against `apps/server/data/arcadeai.db`. Confirm the `user` table has all extended columns and `session` / `account` / `verification` tables exist.
- Re-run `packages/db/src/post-migrate.ts` from step 1 (the `vec0` virtual table create) to ensure no regression.

### Task 7 — `.env.example` audit

Confirm all keys from §15 are present. If anything is missing (likely `BETTER_AUTH_*` and OAuth pairs were stubbed in step 1), add them. Do not commit real secrets.

### Task 8 — Frontend: TanStack Query session hook (`apps/web/src/lib/auth.ts` + `apps/web/src/hooks/useSession.ts`)

- A `fetchMe()` function calling `GET /api/me` with `credentials: 'include'`. Returns the user or `null` on 401.
- A `useSession()` hook wrapping `useQuery({ queryKey: ['me'], queryFn: fetchMe, retry: false, staleTime: 60_000 })`.
- A `signOut()` function: `fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' })` then `window.location.href = '/sign-in'`.

### Task 9 — Frontend: protected-route guard (`apps/web/src/routes/_authed.tsx`)

Create a `_authed` layout route in TanStack Router with a `beforeLoad`:

```
beforeLoad: async ({ location }) => {
  const me = await queryClient.ensureQueryData({ queryKey: ['me'], queryFn: fetchMe })
  if (!me) {
    throw redirect({
      to: '/sign-in',
      search: { next: location.pathname + location.search },
    })
  }
}
```

Move `/` (dashboard placeholder for now) under this `_authed` layout. Render `<Outlet />` plus the top bar.

### Task 10 — Frontend: `/sign-in` route (`apps/web/src/routes/sign-in.tsx`)

- `beforeLoad`: if `me` is non-null, `throw redirect({ to: validateNext(search.next) ?? '/' })`. `validateNext` only allows same-origin paths starting with `/`.
- Render two buttons: "Continue with Google" → `window.location.href = '/api/auth/sign-in/google?callbackURL=' + encodeURIComponent(nextUrl)`. Same for GitHub.
- Use `next` from search params; default to `/`.

Per §12 frontend implementation note: invoke the `frontend-design` skill when fleshing out the visual.

### Task 11 — Frontend: top bar + user dropdown (`apps/web/src/components/TopBar.tsx`)

- Render in the `_authed` layout above `<Outlet />`.
- Layout: `[Logo (→ /)] [spacer] [User Icon ▾]`. No plan badge, no theme toggle, no usage bars (deferred to steps 7, 8, 12).
- Dropdown content: `display_name`, `email`, separator, "Sign out" item that calls `signOut()`.
- Use shadcn/ui `DropdownMenu` and `Avatar` (install if not already present per §12 list).

### Task 12 — Wire root route + dashboard placeholder (`apps/web/src/routes/index.tsx`)

Under the `_authed` layout, render a placeholder dashboard ("Dashboard coming soon") so the route resolves and the top bar shows. Step 5 replaces this with the real grid.

### Task 13 — Build + lint pass

- `bun run build` (typecheck + Vite build) passes across all workspaces.
- `bun run check` (Biome) passes.

## Verification steps

Run each in order. All must pass before declaring step 2 complete.

### V1 — Smoke

1. `bun run dev`. Both servers up.
2. `curl http://localhost:3000/api/health` → `{ ok: true, ... }`. Step 1 baseline still works.
3. `curl -i http://localhost:3000/api/me` → `401`.

### V2 — Sign-in redirect

1. In an incognito window, navigate to `http://localhost:5173/`.
2. Browser ends on `http://localhost:5173/sign-in?next=%2F`. Both Google and GitHub buttons render.

### V3 — Google sign-in (non-admin email)

1. Ensure your Google email is **not** in `ADMIN_EMAILS`.
2. Click "Continue with Google" → consent screen → redirected back to `http://localhost:5173/`.
3. Top bar shows the user dropdown. Open it: `display_name` and `email` from Google appear.
4. Inspect SQLite:
   ```
   sqlite3 apps/server/data/arcadeai.db "SELECT email, display_name, tier, credits_remaining_daily, credits_remaining_monthly, daily_reset_at, monthly_reset_at, theme FROM user;"
   ```
   Expect: `tier='free'`, `credits_remaining_daily=500`, `credits_remaining_monthly=3000`, both reset timestamps in the future, `theme='dark'`.
5. `display_name` matches Google's name (or `user-{8 hex}` if Google returned blank).

### V4 — GitHub sign-in

1. Sign out (V6 flow) or use a fresh incognito window.
2. Click "Continue with GitHub" → consent → redirected back to `/`.
3. SQLite shows a second `user` row with `email` from GitHub (or the same row reused if Better Auth links by email — confirm against config; default account-linking is per-provider so a new row is expected unless email-based linking is enabled).
4. Same field invariants as V3.

### V5 — Admin tier assignment

1. Stop the server. Add the Google test email to `ADMIN_EMAILS` in `.env`. Delete the corresponding `user` row (and its `account`/`session` rows) from SQLite to force a fresh first sign-in:
   ```
   sqlite3 apps/server/data/arcadeai.db "DELETE FROM session; DELETE FROM account; DELETE FROM user;"
   ```
2. Restart the server. Sign in with Google.
3. SQLite: row has `tier='admin'`, `credits_remaining_*` = `Number.MAX_SAFE_INTEGER`.

### V6 — Sign-out

1. While signed in, open the user dropdown → "Sign out".
2. Browser lands on `/sign-in`.
3. `curl -i --cookie-jar /dev/null http://localhost:5173/` (or in a fresh incognito after) → guard redirects to `/sign-in`.
4. `curl -i http://localhost:3000/api/me` (without the prior cookie) → 401.

### V7 — Authenticated visit to `/sign-in`

1. Sign in. Manually navigate to `http://localhost:5173/sign-in`.
2. Redirects to `/`.
3. Manually navigate to `http://localhost:5173/sign-in?next=%2Fsome%2Fpath` while authenticated.
4. Redirects to `/some/path` (or `/` if the path is unknown / external).

### V8 — Cross-origin cookie round-trip

1. Sign in. Reload `/`. Session persists (cookie survived).
2. Inspect DevTools → Application → Cookies on `localhost:3000` for the Better Auth session cookie. `SameSite=Lax`, `HttpOnly` set, `Secure` not set (dev).

### V9 — Build + lint

```
bun run build
bun run check
```

Both pass.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — Schema + migration

After tasks 1, 2, 6, and 7 complete (plans config stub, Better Auth schema with extended user columns, generated migration, `.env.example` audit) and the pre-commit gate passes:

```
feat(db): add users table with extended Better Auth columns
```

Includes: `packages/shared/src/plans.ts` stub, `packages/db` schema updates for `user` / `session` / `account` / `verification`, the generated migration, and `.env.example` updates.

### Checkpoint 2 — OAuth wiring + admin allowlist + UI

After tasks 3, 4, 5, and 8–13 complete (databaseHooks admin allowlist, Fastify mount, `/api/me`, sign-in route, protected-route guard, top bar, session hook) and the pre-commit gate passes:

```
feat(auth): wire google + github oauth with admin allowlist
```

Includes: `apps/server/src/lib/auth.ts`, `apps/server/src/plugins/auth.ts`, `apps/server/src/plugins/require-auth.ts`, `apps/server/src/routes/me.ts`, and the `apps/web` sign-in route, `_authed` guard, `TopBar`, and `useSession` hook.

## Rollback notes

This step is additive at the schema and routing layers. Rollback path:

1. **Schema:** the migration adds columns to the `user` table and creates `session` / `account` / `verification` tables. If the migration needs to be reversed, write a down-migration that drops the added columns and the new tables. Simpler in dev: delete `apps/server/data/arcadeai.db` and re-run step 1's migrations only.
2. **Server code:** revert `apps/server/src/lib/auth.ts`, `apps/server/src/plugins/auth.ts`, `apps/server/src/plugins/require-auth.ts`, `apps/server/src/routes/me.ts`, and the registrations in `apps/server/src/index.ts`. The step-1 baseline (`/api/health`, CORS) is untouched.
3. **Frontend:** revert `apps/web/src/routes/_authed.tsx`, `sign-in.tsx`, `index.tsx`, the `TopBar` component, and the `useSession` hook. Step 1 left no auth-coupled UI, so removing these returns the web app to its step-1 placeholder.
4. **Env:** the OAuth client IDs/secrets and `BETTER_AUTH_*` keys can stay in `.env` harmlessly. Removing `ADMIN_EMAILS` reverts admin-tier assignment behavior on next first sign-in (not retroactive).
5. **Shared package:** the minimal `packages/shared/src/plans.ts` is consumed by step 8 anyway; safe to leave even on rollback. If reverting, delete the file and the export line from `packages/shared/src/index.ts`.

No data outside `apps/server/data/arcadeai.db` is modified. No external services have writes (OAuth apps are read-only consumers of credentials).
