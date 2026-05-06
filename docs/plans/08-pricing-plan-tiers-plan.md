# 08 — Pricing page + plan tiers — Implementation Plan

Aligns with `docs/designs/08-pricing-plan-tiers.md` and SPEC §10, §11, §12, §19.

## Pre-flight

- Step 7 (credit model + usage tracking) must be complete and merged.
  This plan reuses step 7's reset-time helpers (`nextDailyReset(now)`,
  `nextMonthlyReset(now)` or equivalent) and the `users` credit
  columns. If those helpers do not yet exist, stop and finish step 7
  first — do not duplicate them here.
- Verify `users.tier` enum currently accepts `'free' | 'creator' | 'pro' | 'admin'`
  per SPEC §5. No schema change in this step.
- Verify `/api/me` already returns `tier` and credit fields (step 7).
- Verify the top bar component from step 2 exists and is the integration
  point for the plan badge.
- Confirm `packages/shared` is wired into both `apps/web` and `apps/server`
  via `@arcadeai/shared` path alias (SPEC §4).
- Confirm a Zod validation plugin is already registered server-side
  (SPEC §14). If not, this step is not the place to introduce one.

## Tasks (ordered)

### 1. Shared plan config — extend `packages/shared/src/plans.ts`

Step 02 owns the canonical credit-limit export `TIER_CREDIT_LIMITS`
(shape `Record<Tier, { monthly: number; daily: number; dailyEnforced:
boolean }>`). Step 08 does **not** redeclare or rename it. Consume it
for credit numbers; add only the display-specific data step 08 owns.

- Define and export display types: `PublicTier`, `DisplayTier`,
  `BillingInterval`, `PlanCopy` (per design doc Architecture §
  "Shared plan config"). `Tier` already exists from step 02.
- Export `PLAN_PRICES: Record<DisplayTier, { monthly: number; yearly:
  number } | null>` with values from SPEC §10:
  - `free: { monthly: 0, yearly: 0 }`
  - `creator: { monthly: 15, yearly: 13 }` (yearly is per-month
    after the 15% discount; SPEC §10: $156 billed yearly)
  - `pro: { monthly: 29, yearly: 25 }` (SPEC §10: $300 billed yearly)
  - `enterprise: null` (display-only, "Custom")
- Export `YEARLY_DISCOUNT = 0.15`.
- Export `PLANS: PlanCopy[]` with four entries (Free, Creator, Pro,
  Enterprise) populated from SPEC §10. Copy strings (name, features,
  CTA labels, accent color) live here, not in JSX. Numeric credit
  values are NOT duplicated into `PLANS` — `PlanCard` reads credit
  numbers from `TIER_CREDIT_LIMITS[plan.id]` and price numbers from
  `PLAN_PRICES[plan.id]`. The Enterprise entry has no
  `TIER_CREDIT_LIMITS` row (it is not a `Tier`); its card renders
  "Custom" for both price and credits.
- Re-export the new symbols from `packages/shared/src/index.ts`.

Checkpoint: `bun run build` succeeds across the workspace; types
resolve in both apps; `TIER_CREDIT_LIMITS` is imported (not
redeclared) by both the pricing components and the billing route.

### 2. Pricing route + components — invoke `frontend-design` skill

Invoke the `frontend-design` skill before writing any UI code in this
step. All four components below must follow CodeWisp aesthetic per
SPEC §12 (dark background, monospace, neon borders).

- `apps/web/src/routes/pricing.tsx` — TanStack Router file route, auth
  optional. Composes the page: `AdminBanner` (conditional) +
  `IntervalToggle` + grid of four `PlanCard`s mapped from `PLANS`.
  Uses `useQuery(['me'])` and tolerates 401 (logged-out → `me = null`).
  Top-of-file comment documents the no-op contract from SPEC §12 so
  future contributors do not "fix" the empty handlers.
- `apps/web/src/components/pricing/PlanCard.tsx` — props: `plan: PlanCopy`,
  `interval: BillingInterval`, `isActive: boolean`. Renders neon border
  in `plan.accent`, price line that switches on interval, feature
  bullets, optional `ACTIVE` pill, and CTA button with chevron and
  `onClick={() => {}}`.
- `apps/web/src/components/pricing/IntervalToggle.tsx` — local
  controlled pill toggle (`monthly` | `yearly`), default `monthly`,
  `-15%` badge on yearly side. State is in-memory only (no
  localStorage — design doc Open Questions).
- `apps/web/src/components/pricing/AdminBanner.tsx` — full-width banner
  with literal text "Admin access — all features unlocked." per SPEC §12.

Checkpoint: route renders for both auth states, all four cards visible,
no console errors.

### 3. Monthly/yearly toggle wiring

- Page holds `interval` state, passes to each `PlanCard`.
- `PlanCard` price line reads `PLAN_PRICES[plan.id]`:
  - Free: `PLAN_PRICES.free.monthly` / `.yearly` (both `0`) → renders
    `$0`.
  - Creator/Pro monthly: `PLAN_PRICES[id].monthly` ($15 / $29).
  - Creator/Pro yearly: `PLAN_PRICES[id].yearly` (per-month after
    the `YEARLY_DISCOUNT`; SPEC §10: $13/mo Creator, $25/mo Pro).
    Sublabel: "$N billed yearly".
  - Enterprise: `PLAN_PRICES.enterprise === null` → renders "Custom".
- Yearly side of toggle shows `-15%` badge.

Checkpoint: toggling the pill changes Creator/Pro prices; Free and
Enterprise unchanged.

### 4. ACTIVE pill logic

- In `pricing.tsx`, compute `activeTier` from `me`:
  - `me === null` → `null` (logged out).
  - `me.tier === 'admin'` → `null` (banner replaces per-card affordance).
  - Otherwise → `me.tier` if it is one of `'free' | 'creator' | 'pro'`,
    else `null`.
- Pass `isActive={plan.id === activeTier}` to each `PlanCard`.
- `PlanCard` renders `ACTIVE` pill iff `isActive` and `plan.id !==
  'enterprise'` (Enterprise can never be ACTIVE per SPEC §12).
- During `me` query loading, render no banner and no `ACTIVE` pill —
  cards render normally (design doc Open Questions: avoid free→admin
  flicker).

Checkpoint: free/creator/pro user sees pill on their tier; admin and
logged-out users see none.

### 5. Admin banner variant

- `AdminBanner` rendered iff `me?.tier === 'admin'`.
- Confirm no `ACTIVE` pill on any card when admin.
- Banner appears above the interval toggle.

Checkpoint: admin user sees banner; non-admin users do not.

### 6. Top bar plan badge

- `apps/web/src/components/topbar/PlanBadge.tsx` — invoke
  `frontend-design` skill for the visual treatment.
  - Reads `tier` from the existing `/api/me` query (no new fetch).
  - Maps tier → label + style per SPEC §12 / design doc:
    - `free` → green outline pill, label "FREE"
    - `creator` → solid orange pill, "CREATOR"
    - `pro` → solid yellow pill, "PRO"
    - `admin` → purple gradient pill, "ADMIN"
  - Renders a `<Link to="/pricing">` (TanStack Router) so middle/cmd
    click works.
  - While `me` loading: render a skeleton/placeholder of fixed width
    to avoid layout shift.
- Mount the badge in the existing top bar component from step 2,
  positioned next to the logo per SPEC §12 layout.
- Badge inherits top bar visibility — already hidden on `/sign-in`.

Checkpoint: each tier displays the correct color/label; clicking
navigates to `/pricing`.

### 7. Billing endpoint — `POST /api/billing/change-plan`

- New file `apps/server/src/routes/billing.ts`, registered under the
  `/api` prefix with the existing session middleware (SPEC §14).
- Zod body schema:
  ```
  {
    tier: z.enum(['free', 'creator', 'pro']),
    interval: z.enum(['monthly', 'yearly']),
  }
  ```
  Rejects `'enterprise'`, `'admin'`, missing fields → 400 with
  field-level message.
- Handler steps:
  1. Resolve current user from session.
  2. If `user.tier === 'admin'` → 400
     `{ error: 'Admin tier cannot be changed via billing' }`.
  3. Look up `TIER_CREDIT_LIMITS[body.tier]` from `@arcadeai/shared`
     (canonical export from step 02). Use `.monthly` for the monthly
     allotment and `.daily` for the daily counter.
  4. Compute `now = Date.now()`, `dailyResetAt = nextDailyReset(now)`,
     `monthlyResetAt = nextMonthlyReset(now)` using step 7's helpers.
  5. `UPDATE users SET tier = ?, credits_remaining_monthly = ?,
     credits_remaining_daily = ?, monthly_reset_at = ?,
     daily_reset_at = ?, updated_at = ? WHERE id = ?`.

     Per SPEC §10's paid-tier daily clarification, the reset on tier
     change writes BOTH `credits_remaining_monthly` AND
     `credits_remaining_daily` to the new tier's allotments. For paid
     tiers `TIER_CREDIT_LIMITS[tier].daily === .monthly` and
     `dailyEnforced === false` — the daily counter is initialized for
     observability/parity but the daily check is skipped at deduct
     time (step 07).
  6. Respond 200 with the same shape `GET /api/me` returns so the
     client can `queryClient.setQueryData(['me'], response)`.
- `interval` is validated but not stored. Add a code comment marking
  this as intentional (design doc Key Decisions).
- Do **not** write a row to `usage_log` (design doc Open Questions —
  plan changes are not usage events).
- Frontend code does **not** call this endpoint — buttons remain
  `onClick={() => {}}` per SPEC §12.

Checkpoint: endpoint reachable via curl; updates DB and returns
correct shape.

## Verification

Run in order. All must pass before considering the step complete.

1. **Build + lint:** `bun run build` and `bun run check` clean.
2. **Logged-out `/pricing`:** open in a private window → four cards
   (Free green, Creator orange, Pro yellow, Enterprise purple),
   no `ACTIVE` pill, no admin banner, all four CTA buttons render
   with chevron and do nothing on click (verify no network request
   in devtools).
3. **Toggle:** flip to yearly → Creator shows `$13/mo`, Pro shows
   `$25/mo`, Free stays `$0`, Enterprise stays "Custom"; `-15%`
   badge visible on yearly side.
4. **Free user:** sign in as a non-admin user (tier `'free'`) →
   `ACTIVE` pill on Free card only; top bar shows green outline
   `FREE` badge; clicking the badge navigates to `/pricing`.
5. **Creator/Pro user:** manually `UPDATE users SET tier='creator'
   WHERE id=...` in SQLite, refresh → `ACTIVE` pill moves to Creator,
   badge becomes orange `CREATOR`. Repeat for `'pro'`.
6. **Admin user:** sign in with email in `ADMIN_EMAILS` → banner
   "Admin access — all features unlocked." renders above cards;
   no `ACTIVE` pill on any card; badge is purple gradient `ADMIN`.
7. **No-op buttons:** click `CHOOSE PLAN` and `CONTACT SALES` →
   network tab confirms no request to `/api/billing/change-plan`;
   page state unchanged.
8. **Endpoint happy path:** as a Free user session,
   `curl -X POST -b cookies.txt -H 'content-type: application/json'
   -d '{"tier":"creator","interval":"monthly"}'
   http://localhost:3000/api/billing/change-plan` → 200 with updated
   user shape; SQLite check: `tier='creator'`,
   `credits_remaining_monthly=20000`, `credits_remaining_daily=20000`
   (paid-tier daily initialized to monthly value per SPEC §10),
   both reset timestamps in the future; `GET /api/me` reflects the
   change.
9. **Endpoint validation:** body `{tier:'enterprise',...}` → 400;
   `{tier:'admin',...}` → 400; missing `interval` → 400. Each
   returns a field-level Zod error.
10. **Endpoint admin guard:** as an admin user session, POST a valid
    body → 400 with admin guard message; verify
    `users.tier` unchanged.
11. **Shared config wiring:** edit `PLAN_PRICES.creator.monthly` in
    `packages/shared/src/plans.ts`, reload `/pricing` → new price
    shows on the Creator card; revert. Repeat by editing
    `TIER_CREDIT_LIMITS.creator.monthly` (owned by step 02) → the
    Creator card's credit-line display updates on reload, confirming
    the card consumes step 02's canonical export rather than a
    duplicated constant.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — Shared plan config

After task 1 (extend `packages/shared/src/plans.ts` with prices and copy) completes and the pre-commit gate passes:

```
feat(shared): add plan prices and copy config
```

Includes: `PLAN_PRICES`, plan copy/feature lists, and any related constants exported from `packages/shared/src/plans.ts`.

### Checkpoint 2 — Pricing UI + billing endpoint

After tasks 2–7 complete (pricing route, monthly/yearly toggle, ACTIVE pill, admin banner, top-bar plan badge, billing change-plan endpoint) and the pre-commit gate passes:

```
feat(pricing): build pricing page and billing change-plan endpoint
```

Includes: `apps/web/src/routes/pricing.tsx`, pricing components, top-bar plan badge, and `POST /api/billing/change-plan` in `apps/server/src/routes/billing.ts`.

## Rollback

- All changes are additive. To revert:
  - Delete `apps/server/src/routes/billing.ts` and remove its
    registration.
  - Delete `apps/web/src/routes/pricing.tsx` and
    `apps/web/src/components/pricing/`.
  - Remove `<PlanBadge />` from the top bar and delete
    `apps/web/src/components/topbar/PlanBadge.tsx`.
  - In `packages/shared/src/plans.ts`, remove only the symbols
    introduced by this step (`PLAN_PRICES`, `YEARLY_DISCOUNT`,
    `PLANS`, `PublicTier`, `DisplayTier`, `BillingInterval`,
    `PlanCopy`) and their re-exports from `index.ts`. Do **not**
    delete the file or remove `Tier` / `TIER_CREDIT_LIMITS` — those
    are owned by step 02 and consumed by step 07.
- No DB migration was added; no schema rollback needed.
- No `users` rows are mutated by deploying or reverting this step.
  Only the `change-plan` endpoint mutates rows, and it is not called
  by any UI.
