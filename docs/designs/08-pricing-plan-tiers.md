# 08 — Pricing page + plan tiers

## Overview

Add the public `/pricing` route, the color-coded plan badge in the
authenticated top bar, and a `POST /api/billing/change-plan` endpoint
that — in this prototype — directly mutates `users.tier` and resets the
credit counters to the new tier's allotment. No Stripe, no subscription
state machine, no webhook. The endpoint shape mirrors what a real
Stripe integration would call, so a future swap is a backend-only
change.

The pricing page implements the CodeWisp aesthetic from SPEC §12: dark
background, monospace, neon-bordered cards (Free=green, Creator=orange,
Pro=yellow, Enterprise=purple), monthly/yearly toggle with a `-15%`
badge on the yearly side, an `ACTIVE` pill on the user's current plan
(Free/Creator/Pro only), an Admin banner variant, and `CHOOSE PLAN` /
`CONTACT SALES` buttons that are intentional no-ops
(`onClick={() => {}}`) per SPEC §12.

Plan data is the single source of truth at
`packages/shared/src/plans.ts`, consumed by both the pricing page
(card content) and the top bar badge (color and label).

## Goals

- `/pricing` route is reachable logged-out and logged-in (SPEC §12
  routes table — `auth: optional`).
- Four tier cards: Free, Creator, Pro, Enterprise — content per
  SPEC §10 tier table (prices, credit allotments, "Contact Sales"
  for Enterprise).
- Monthly/yearly toggle with a `-15%` badge on the yearly option;
  yearly prices match SPEC §10 ($13/mo for Creator, $25/mo for Pro;
  Free shows $0 either way; Enterprise shows "Custom").
- Top bar plan badge — color-coded pill per SPEC §12: Free = green
  outline, Creator = orange, Pro = yellow, Admin = purple gradient.
  Reads `tier` from `/api/me`. Click navigates to `/pricing`.
- `ACTIVE` pill rendered on the card matching the current user's
  tier, but only for Free/Creator/Pro (SPEC §12). Admin sees no
  `ACTIVE` pill on any card and a banner instead. Logged-out users
  see no `ACTIVE` pill and no admin banner.
- `POST /api/billing/change-plan` validates `{ tier, interval }`
  with Zod, updates `users.tier`, resets `credits_remaining_daily`
  and `credits_remaining_monthly` to the new tier's allotment per
  SPEC §10 ("Plan downgrade: immediate reset; Plan upgrade:
  immediate top-up"), and resets `daily_reset_at` /
  `monthly_reset_at` to the next UTC midnight / first-of-month.
  Both counters are written on every tier change; per SPEC §10's
  paid-tier daily clarification, paid tiers initialize the daily
  counter to the monthly value (the daily check is not enforced —
  it is informational only). Returns the updated user shape.
- The endpoint exists and is wired up but the frontend buttons
  do not call it (SPEC §12 — buttons are no-ops). It is reachable
  from a future Stripe webhook or from manual testing only.
- Plan data lives in `packages/shared/src/plans.ts` and is
  imported by both the web app and the server.

## Non-goals (explicitly deferred)

- **No real Stripe integration.** No `stripe` package, no checkout
  session, no webhook signature verification, no
  `STRIPE_SECRET_KEY` env var. SPEC §15's `.env.example` does not
  list any Stripe variables and SPEC §2 places real billing out of
  scope.
- **No subscription state machine.** No `subscription_status`
  column, no `current_period_end`, no proration logic, no past-due
  / canceled / unpaid handling. The user's tier is a single column
  on `users` (SPEC §5) and changing it is a single UPDATE.
- **No purchase flow on the frontend.** `CHOOSE PLAN` and
  `CONTACT SALES` buttons render with the documented chevron
  affordance but their `onClick` is `() => {}` per SPEC §12. The
  user-visible contract is "this is a prototype; the buttons do
  nothing." The buttons are kept rendered (not hidden, not
  disabled) so the layout matches CodeWisp visually and so a
  future step can wire them to a real handler with a one-line
  change.
- **Enterprise is display-only.** No tier value `'enterprise'`
  exists in `users.tier` (SPEC §5 enumerates `'free' | 'creator' |
  'pro' | 'admin'`). The Enterprise card is presentational only;
  even the no-op endpoint rejects `tier: 'enterprise'` in its
  Zod body schema.
- **No yearly billing semantics on the server.** The endpoint
  accepts `interval: 'monthly' | 'yearly'` per SPEC §11 but does
  not store it, since there is no billing cycle to track. A real
  Stripe integration would persist this; the prototype does not.
- **No usage-bar refresh wiring beyond what the credit-model
  step (7) provides.** When `change-plan` runs, the response
  contains the updated user; the frontend invalidates `/api/me`
  via TanStack Query. No new mechanism is introduced here.
- **No admin tier on the pricing page.** Admin is internal
  (SPEC §10) and the cards do not include an Admin entry. The
  Admin user experience is the banner only.

## Architecture

### Shared plan config

`packages/shared/src/plans.ts` is the single source of truth.
Step 02 owns the canonical credit-limit export `TIER_CREDIT_LIMITS`
(shape `{ monthly, daily, dailyEnforced }` per `Tier`); step 07
extends with `CREDIT_COSTS`. Step 08 adds only display-specific
data (prices, UI copy, discount). It does **not** redeclare or
rename credit limits.

```ts
// Already exported by step 02:
//   export type Tier = 'free' | 'creator' | 'pro' | 'admin';
//   export const TIER_CREDIT_LIMITS: Record<Tier, {
//     monthly: number; daily: number; dailyEnforced: boolean;
//   }> = { ... };

// New in step 08:
export type PublicTier = 'free' | 'creator' | 'pro';
export type DisplayTier = PublicTier | 'enterprise';
export type BillingInterval = 'monthly' | 'yearly';

export interface PlanCopy {
  id: DisplayTier;
  name: string;            // "Free" | "Creator" | "Pro" | "Enterprise"
  features: string[];
  ctaLabel: string;        // "CHOOSE PLAN" | "CONTACT SALES"
  accent: 'green' | 'orange' | 'yellow' | 'purple';
}

export const PLAN_PRICES: Record<DisplayTier, {
  monthly: number;
  yearly: number;          // per-month after the 15% yearly discount
} | null> = {
  free:       { monthly: 0,  yearly: 0 },
  creator:    { monthly: 15, yearly: 13 },   // SPEC §10: $156/yr
  pro:        { monthly: 29, yearly: 25 },   // SPEC §10: $300/yr
  enterprise: null,                          // "Custom"
};

export const YEARLY_DISCOUNT = 0.15;

export const PLANS: PlanCopy[] = [/* Free, Creator, Pro, Enterprise */];
```

`PlanCard` reads price numbers from `PLAN_PRICES[plan.id]` and
credit numbers from `TIER_CREDIT_LIMITS[plan.id]` (Free/Creator/Pro
only — Enterprise is not a `Tier` and renders "Custom" for both
lines). Numbers are not duplicated into `PLANS`; that array carries
display strings and accent metadata only.

Credit numbers per SPEC §10 (sourced from step 02's
`TIER_CREDIT_LIMITS`):

- Free: 3,000/mo, 500/day enforced cap.
- Creator: 20,000/mo, daily counter initialized to 20,000,
  `dailyEnforced: false`.
- Pro: 50,000/mo, daily counter initialized to 50,000,
  `dailyEnforced: false`.

For paid tiers the daily counter is initialized to the monthly
allotment per SPEC §10; the daily check is skipped at deduct time
(step 07).

### Pricing page

`apps/web/src/routes/pricing.tsx` (TanStack Router file route).
Auth not required — the route is rendered for both logged-out and
logged-in sessions (SPEC §12).

```
PricingRoute
  ├─ useQuery('/api/me') — optional; tolerates 401 (logged-out)
  ├─ AdminBanner — visible iff me.tier === 'admin'
  ├─ IntervalToggle (monthly | yearly) — local state, default 'monthly'
  └─ Grid of 4 PlanCard components mapped from PLANS
        └─ PlanCard
              ├─ neon border in plan.accent
              ├─ price line — switches on interval
              ├─ feature bullets
              ├─ ACTIVE pill iff me?.tier === plan.id and tier in {free, creator, pro}
              │   (never on Enterprise; never if me.tier === 'admin'; never if logged out)
              └─ CTA button with chevron — onClick={() => {}}
```

Components:

- `apps/web/src/routes/pricing.tsx` — route + page composition.
- `apps/web/src/components/pricing/PlanCard.tsx` — single card.
- `apps/web/src/components/pricing/IntervalToggle.tsx` — pill
  toggle with `-15%` badge on the yearly side.
- `apps/web/src/components/pricing/AdminBanner.tsx` — full-width
  banner: "Admin access — all features unlocked." (SPEC §12).

Visual treatment follows SPEC §12's CodeWisp aesthetic and SPEC
§12's instruction: "When implementing UI components, invoke the
`frontend-design` skill to ensure production-grade, distinctive
design quality." Dark background, monospace font stack, neon
borders, generous spacing.

### Top bar plan badge

`apps/web/src/components/topbar/PlanBadge.tsx`. Mounted in the
existing top bar (introduced in step 2). Reads `tier` from the
`/api/me` query already cached by the user dropdown.

```
PlanBadge
  ├─ tier === 'free'    → green outline pill, "FREE"
  ├─ tier === 'creator' → solid orange pill, "CREATOR"
  ├─ tier === 'pro'     → solid yellow pill, "PRO"
  ├─ tier === 'admin'   → purple gradient pill, "ADMIN"
  └─ Click → router.navigate('/pricing')
```

Hidden on `/sign-in` and on routes where the top bar itself is
not rendered. Uses `<Link to="/pricing">` so middle-click + new
tab works.

### Billing endpoint

`apps/server/src/routes/billing.ts`:

```
POST /api/billing/change-plan
    │
    ├─ session check (existing middleware)
    ├─ Zod-validate body: {
    │     tier: 'free' | 'creator' | 'pro',     // 'admin' and
    │                                          // 'enterprise' rejected
    │     interval: 'monthly' | 'yearly'
    │   }
    ├─ Refuse if me.tier === 'admin' →
    │     400 { error: 'Admin tier cannot be changed via billing' }
    │     (defense in depth; the UI already hides this path)
    ├─ Look up TIER_CREDIT_LIMITS[tier] from @arcadeai/shared
    │     (canonical export from step 02)
    ├─ now = Date.now()
    ├─ UPDATE users SET                       // per SPEC §10:
    │     tier = ?,                           //   plan change writes
    │     credits_remaining_monthly = ?,      //   .monthly AND .daily
    │     credits_remaining_daily = ?,        //   to new tier's allotments;
    │                                         //   paid tiers initialize
    │                                         //   daily to monthly value
    │                                         //   (not enforced)
    │     monthly_reset_at = <first of next month UTC, ms>,
    │     daily_reset_at   = <next UTC midnight, ms>,
    │     updated_at = ?
    │     WHERE id = ?
    ├─ return GET /api/me's response shape (recompute) so the
    │   client can swap it directly into the cache
    └─ return 200
```

The reset-time computation reuses the helper that step 7 introduces
for lazy reset (SPEC §10) — both the lazy-reset path and the
plan-change path need "next UTC midnight" and "first of next month
UTC". If step 7's helper is named something like
`nextDailyReset(now)` / `nextMonthlyReset(now)` it is reused
verbatim here.

### Logged-out behavior

`/api/me` returns 401 without a session. The pricing page treats
401 as "no current user" — `me` is `null`, no `ACTIVE` pill is
rendered, no admin banner. The `CHOOSE PLAN` buttons remain
rendered and remain no-ops (SPEC §12).

## Key decisions

### Why no-op buttons stay rendered (and visible) instead of disabled

SPEC §12 spells this out: `onClick={() => {}}`. Disabling them or
hiding them would deviate from the documented prototype contract
and from the CodeWisp visual reference. The CodeWisp aesthetic
needs the chevron CTAs at the bottom of every card — without them
the cards look broken. The no-op is intentional and is part of
the prototype's stated scope (SPEC §2 — "Real billing... not
implemented"). A future step swaps the click handler for a real
one without touching layout.

A documentation note in the route file's top-of-file comment
makes the intent explicit so future contributors don't "fix" the
empty handler.

### Why ACTIVE pill is suppressed for Admin

SPEC §12 explicitly: "Admin users: show a banner at the top —
'Admin access — all features unlocked.' No 'ACTIVE' pill on any
card." Admin isn't a card on the pricing page (it's not a
purchasable tier per SPEC §10), so there's no card to mark
active. The banner replaces the per-card affordance with a
single global signal.

### Why plan config lives in `packages/shared`

SPEC §4 commits `packages/shared/src/plans.ts` as the location.
Both the web app (cards, badge label/color) and the server
(credit grants in `change-plan`, and in step 7 for first-sign-in
allotments) consume it. Putting it in either app would force a
duplicate or a cross-app import. The shared package is already
in the workspace graph and is the documented home.

The displayed copy (feature bullets, prices) is also in
`plans.ts` rather than embedded in JSX so the pricing page is
data-driven — adding/removing a tier or changing copy is a
single-file edit.

### Why `interval` is accepted but not stored

SPEC §11's body shape includes `interval: 'monthly' | 'yearly'`.
The endpoint must validate that shape so a future Stripe
integration (which absolutely cares about interval) doesn't
require an API change. But there's no billing cycle in the
prototype, so storing it serves nothing. The handler ignores it
after Zod validation. A code comment marks this so it isn't
mistaken for a bug.

### Why Enterprise is rejected by Zod, not by an `if` branch

Centralizing the "valid purchasable tiers" set in the Zod schema
gives one error path (`400` with field-level message) and keeps
the handler body tier-agnostic. Adding a new tier (e.g.
"Studio") later means updating the schema + `PLAN_CREDITS`; the
handler body doesn't change.

### Why the badge uses `<Link>`, not a button with `navigate()`

`<Link to="/pricing">` from TanStack Router gives proper
middle-click / cmd-click / right-click semantics for free.
Pricing is a real page, not an action; treating it as a link
matches user expectations.

### Top-bar badge polling vs. invalidation

The badge reads from the same `/api/me` TanStack Query cache as
the user dropdown. When `change-plan` runs (e.g. via direct API
call in this prototype), the response shape matches `/api/me` so
the caller can `queryClient.setQueryData(['me'], response)` and
the badge re-renders. No new fetch is added. (In practice
nothing in the UI calls `change-plan` in this step — the
mechanism is documented for future use.)

## Open questions

- **Should `change-plan` log to `usage_log`?** SPEC §5 lists
  actions as `'generation' | 'refinement' | 'repair'`. A plan
  change is not a usage event; it shouldn't pollute the table.
  Decision: do not log to `usage_log`. A future audit trail for
  billing events lives in its own table when it exists.
- **Should the pricing page show the Admin banner if the
  `/api/me` request is in flight?** Decision: render nothing
  (banner suppressed) until `me` resolves. The flicker of "free
  → admin" is worse than a 100ms blank where the banner would
  be. Cards render normally during the wait.
- **Should the badge be visible on `/sign-in`?** No — the top
  bar is not rendered on `/sign-in` per step 2. The badge is a
  child of the top bar; it inherits that visibility.
- **Should the no-op buttons surface a toast like "Coming
  soon"?** SPEC §12 says `onClick={() => {}}`. Adding a toast
  would deviate. If it becomes a UX problem (users click and
  nothing happens), revisit; otherwise, leave it as-is.
- **Yearly toggle persistence.** Should the toggle's state
  survive page reloads (localStorage)? Decision: no. Pricing is
  a low-traffic page and the toggle is cheap to flip. Keep it
  as in-memory state.

## Acceptance criteria

1. **Logged-out pricing page.** Navigate to `/pricing` without
   signing in:
   - Four cards render: Free (green), Creator (orange), Pro
     (yellow), Enterprise (purple).
   - No `ACTIVE` pill on any card.
   - No Admin banner.
   - All four `CHOOSE PLAN` / `CONTACT SALES` buttons render
     with the chevron and do nothing on click.
   - Monthly/yearly toggle changes the displayed prices on
     Creator and Pro cards (Free stays $0, Enterprise stays
     "Custom"). Yearly side shows a `-15%` badge.
2. **Logged-in Free user.** Sign in as a Free user, visit
   `/pricing`:
   - Same four cards.
   - `ACTIVE` pill on the Free card only.
   - Top bar: green outline `FREE` badge.
   - Badge click navigates to `/pricing`.
3. **Logged-in Creator/Pro user.** Manually update the user's
   `tier` in SQLite to `'creator'` (or `'pro'`), refresh:
   - `ACTIVE` pill moves to the Creator (or Pro) card.
   - Top bar badge changes color/label accordingly.
4. **Admin user.** Sign in with an email in `ADMIN_EMAILS`:
   - Pricing page shows the Admin banner above the cards.
   - No `ACTIVE` pill on any card.
   - All buttons remain no-ops.
   - Top bar badge is purple gradient `ADMIN`.
5. **`POST /api/billing/change-plan` happy path.** With a Free
   user session, `curl -X POST .../api/billing/change-plan -d
   '{"tier":"creator","interval":"monthly"}'`:
   - 200 response with the updated user shape.
   - SQLite check: `users.tier = 'creator'`,
     `credits_remaining_monthly = 20000`, reset timestamps in
     the future.
   - `GET /api/me` reflects the change.
6. **`change-plan` rejects invalid tiers.** Body
   `{tier:"enterprise", interval:"monthly"}` → 400 with a
   field-level Zod error. Body `{tier:"admin", ...}` → 400.
   Body without `interval` → 400.
7. **`change-plan` rejects admins.** Sign in as an admin, call
   the endpoint with a valid body → 400 with the admin guard
   message. Verify `users.tier` unchanged.
8. **No-op buttons confirmed.** Click any `CHOOSE PLAN` or
   `CONTACT SALES` button on the pricing page. Verify in the
   network tab: no request to `/api/billing/change-plan` is
   issued. The page state does not change.
9. **Plan config is the source of truth.** Importing `PLANS`
   from `@arcadeai/shared` in `apps/web` and `PLAN_CREDITS` in
   `apps/server` resolves cleanly via the workspace's path
   aliases (SPEC §4). Editing a price in `plans.ts` updates the
   pricing page on next reload.
