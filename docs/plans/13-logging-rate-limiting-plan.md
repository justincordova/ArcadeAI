# 13 — Logging + Rate Limiting Polish — Implementation Plan

Implements the design in `docs/designs/13-logging-rate-limiting.md`.
Grounded in SPEC §3, §14, §15, §19.

## Pre-flight

Confirm before starting. Stop and resolve if anything is missing.

- **Step 1 complete.** `apps/server/src/index.ts` constructs Fastify
  with Pino as the built-in logger; `pino-pretty` already loads in
  dev (SPEC §3, §19). `@fastify/cors` is registered. `GET /api/health`
  responds unauthenticated. `LOG_LEVEL` may already be plumbed; if not,
  task 1 below adds it.
- **Step 2 complete.** Better Auth session middleware attaches a
  `session` to `request` for authenticated routes (SPEC §14). The
  `request-context` plugin in this step depends on the auth hook
  having already run by the time it reads `request.session`.
- **Steps 4, 6, 11 complete.** The streaming endpoints exist:
  `POST /api/games`, `POST /api/games/:id/refine`,
  `POST /api/games/:id/repair`. Each uses `streamText` from the AI
  SDK and exposes a `usage` object with `promptTokens` and
  `completionTokens` (SPEC §3).
- **Step 10 complete (or stub-able).** `gpt-4.1-mini` classifier
  helpers exist (`classifyGenre`, `categorizeError`). The cost-log
  changes apply uniformly to them; if step 10 has not landed,
  thread the logger through whichever GPT-4.1-mini call sites do
  exist and add the rest when step 10 lands.
- **`packages/shared/src/models.ts` exists** with the pinned model
  IDs (SPEC §3). Price table fields and `computeCost` are added on
  top of the existing exports.
- **`@fastify/rate-limit` is in the dependency list per SPEC §3.**
  If not yet installed, task 6 installs it (`bun add @fastify/rate-limit`
  in `apps/server`).

## Ordered tasks

### 1. Pino bootstrap + `LOG_LEVEL` + `pino-pretty` gating

In `apps/server/src/index.ts`:

- Read `process.env.LOG_LEVEL` (default `'info'`) and pass to the
  Fastify logger config (SPEC §15).
- Gate `transport: { target: 'pino-pretty', ... }` on
  `process.env.NODE_ENV === 'development'` (SPEC §3). Production-style
  runs emit raw JSON.
- Set `genReqId: () => randomUUID()` (from `node:crypto`).
- Set `disableRequestLogging: true` so Fastify's default `incoming
  request` / `request completed` lines are suppressed; we own the
  shape per SPEC §14.
- Configure compact serializers for `req` (method, url) and `res`
  (statusCode) so Fastify's default error serializer doesn't dump
  headers/body.

```ts
const isDev = process.env.NODE_ENV === 'development';
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(isDev ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  },
  genReqId: () => randomUUID(),
  disableRequestLogging: true,
});
```

### 2. `request-context` plugin

Create `apps/server/src/plugins/request-context.ts`. Register **after**
the auth plugin so `request.session` is populated before this hook
fires.

- `preHandler` hook: attach a child logger to `req.log` carrying
  `{ requestId: req.id, userId: req.session?.user?.id ?? null }`.
- `onRequest` hook (or the same `preHandler`, before child rebind):
  set `req.startTime = Date.now()`.
- `onResponse` hook: emit one structured INFO line:

  ```ts
  req.log.info(
    {
      route: req.routeOptions?.url ?? req.url,
      method: req.method,
      status: reply.statusCode,
      duration_ms: Date.now() - req.startTime,
    },
    'request completed',
  );
  ```

  Per SPEC §14: fields are `requestId, userId, route, method, status,
  duration_ms`. `requestId` and `userId` are inherited from the child
  logger.

- TypeScript declaration merging:

  ```ts
  declare module 'fastify' {
    interface FastifyRequest {
      startTime: number;
    }
  }
  ```

  The `req.session` type comes from the Better Auth plugin (step 2).

Register in `apps/server/src/index.ts` immediately after the auth
plugin and before route registration.

### 3. Error handler logging

In the existing global error handler (or a new
`apps/server/src/plugins/error-handler.ts` if step 2 didn't add one):

- On any uncaught error reaching the handler, call
  `request.log.error({ err }, 'request failed')`. Pino's default `err`
  serializer captures message, stack, code.
- Then send the standard error response (status 500 unless the error
  carries a `statusCode`).
- The `onResponse` hook from task 2 still fires and emits the
  `request completed` line at the right `status`. Total lines per
  failed request: one ERROR + one INFO.

For 4xx responses (validation 400, auth 401, ownership 404, credit 402,
concurrency 409, rate limit 429), the framework / route returns the
response directly — no error handler involvement. The `request
completed` line at the right `status` is sufficient. No extra
ERROR-level log for expected client errors.

### 4. Price table + `computeCost` in `packages/shared/src/models.ts`

Edit `packages/shared/src/models.ts` to add:

- `MODEL_PRICES`: per-million-token input/output rates keyed by model
  ID (SPEC §3, §14). Use list prices for `claude-sonnet-4-6`,
  `claude-opus-4-7`, `gpt-4.1-mini`, `text-embedding-3-small`. Embeddings
  get `output: 0` (no completion tokens).
- `computeCost({ model, usage })`: returns USD float. Unknown model →
  return `0` and do not throw (logging must never crash a request).

```ts
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':       { input: 3.00,  output: 15.00 },
  'claude-opus-4-7':         { input: 15.00, output: 75.00 },
  'gpt-4.1-mini':            { input: 0.40,  output: 1.60 },
  'text-embedding-3-small':  { input: 0.02, output: 0.0 },
};

export function computeCost(args: {
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}): number {
  const p = MODEL_PRICES[args.model];
  if (!p) return 0;
  return (
    (args.usage.promptTokens     / 1_000_000) * p.input +
    (args.usage.completionTokens / 1_000_000) * p.output
  );
}
```

Add a one-line code comment pointing at SPEC §14 so future edits know
the contract.

### 5. Thread `logger` through LLM helpers and emit `llm call` lines

In `apps/server/src/services/llm/client.ts` (and any sibling files
holding GPT-4.1-mini helpers — `categorize-error.ts`,
`classify.ts`, `summarize.ts`, `title.ts`,
`embed.ts`):

- Add an optional `logger?: FastifyBaseLogger` parameter to every
  exported helper (`streamGame`, `streamRefinement`,
  `streamRepair`, `categorizeError`, `classifyGenre`,
  `summarizeForRefinement`, `embedPrompt`, `generateTitle`).
- Around each AI SDK call, capture `start = Date.now()`, await the
  call, read `usage` (the AI SDK exposes `result.usage` after the
  stream finishes), compute `cost_usd = computeCost({ model, usage })`,
  and emit:

  ```ts
  logger?.info(
    {
      model: MODEL_ID,
      tokens_in: usage.promptTokens,
      tokens_out: usage.completionTokens,
      duration_ms: Date.now() - start,
      cost_usd,
    },
    'llm call',
  );
  ```

- For streaming helpers, emit the `llm call` line **after** the
  stream has fully drained (so `usage` is populated). On stream
  error, log at ERROR with the caught error and skip the `llm call`
  INFO line, or emit it with `tokens_out: 0` if the AI SDK populates
  `usage` partially. Default: skip the INFO line on error.

- Embeddings: the AI SDK's `embed` returns a `usage` with
  `tokens` (single number). Map to `{ promptTokens: tokens,
  completionTokens: 0 }` before passing to `computeCost`. Log shape
  remains identical for uniformity.

In each route handler (`POST /api/games`, `/refine`, `/repair`,
title/classify/embed call sites), pass `request.log` as the `logger`
argument when calling the helpers. The `requestId` and `userId`
correlation fields propagate automatically (SPEC §14).

**Logger threading churn (acknowledged scope):** This step adds an
optional `logger?: FastifyBaseLogger` parameter to every LLM helper
introduced in earlier steps. Touch points:
- `apps/server/src/services/llm/client.ts → streamGame export (step 04)`
- `apps/server/src/services/llm/client.ts → streamRefinement export (step 06)`
- `apps/server/src/services/llm/classify.ts` (step 10)
- `apps/server/src/services/llm/title.ts` (step 10)
- `apps/server/src/services/llm/client.ts → streamRepair export (step 11)`
- `apps/server/src/services/llm/categorize-error.ts` (step 11) —
  GPT-4.1-mini error categorization helper, must also accept `logger`
  parameter and emit `llm call` log line per SPEC §14.
- `apps/server/src/services/llm/embed.ts` (step 09)
- `apps/server/src/services/llm/summarize.ts` (step 06 — refinement
  context summarizer)

Note: `streamGame`, `streamRefinement`, and `streamRepair` all live in
the same `client.ts` file (single file, three exports).

Each call site in the route handlers passes `request.log` (Fastify's
per-request child logger). Helpers default to the root pino logger if
`logger` is omitted (preserves backward compatibility for tests /
scripts).

Verification: every LLM call in production code has a `logger`
argument; every LLM log line carries the same `requestId` as the
surrounding request log line.

### 6. Install and register `@fastify/rate-limit`

```sh
bun add @fastify/rate-limit --cwd apps/server
```

Create `apps/server/src/plugins/rate-limit.ts`:

```ts
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    // hook: 'onRequest' runs before auth, which is what we want — rate
    // limit unauthenticated endpoints too (SPEC §14: "all /api/*").
    hook: 'onRequest',
  });
}
```

Register in `apps/server/src/index.ts` after CORS, before routes.

### 7. Apply route-scoped per-user policy on streaming endpoints

In `apps/server/src/routes/games.ts` (the file that registers
`POST /api/games`, `/refine`, `/repair`), declare a shared per-user
policy and attach it to those three routes:

```ts
const perUser10PerMin = {
  rateLimit: {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) =>
      req.session?.user?.id ?? req.ip,
  },
};

app.post('/api/games',                { config: perUser10PerMin }, generateHandler);
app.post('/api/games/:id/refine',     { config: perUser10PerMin }, refineHandler);
app.post('/api/games/:id/repair',     { config: perUser10PerMin }, repairHandler);
```

`@fastify/rate-limit` composes per-route config with the global
config; both are evaluated, the stricter wins (SPEC §14 — defense in
depth on top of credits).

The IP fallback in `keyGenerator` is defensive — auth middleware
already 401s unauthenticated requests on these routes (SPEC §14).
Documented inline.

### 8. 429 response + `Retry-After`

`@fastify/rate-limit` emits a `Retry-After` header by default (in
seconds, value of `timeWindow` remaining). The default 429 body
already matches SPEC §14's intent. No customization required;
verify in tests (task 13).

If a uniform error envelope is enforced elsewhere (e.g. step 2 added
a global error response shape), wrap the 429 body in that envelope via
`errorResponseBuilder`:

```ts
errorResponseBuilder: (_req, ctx) => ({
  statusCode: 429,
  error: 'Too Many Requests',
  message: `Rate limit exceeded, retry in ${ctx.after}`,
}),
```

Otherwise leave the default.

### 9. Replace ad-hoc logging across server

Sweep `apps/server/src/{routes,services,plugins}/**/*.ts` and replace:

- `console.log` → `request.log.info` (with structured fields where
  applicable) when inside a request scope, else `app.log.info`.
- `console.warn` → `request.log.warn` / `app.log.warn`. Examples
  flagged in design doc:
  - Genre classifier fallback (step 10):
    `request.log.warn({ raw }, 'genre classify failed; defaulting to other')`.
  - Repair categorizer fallback (step 11):
    `request.log.warn({ raw }, 'category classify failed; defaulting to runtime')`.
- `console.error` → `request.log.error({ err }, 'message')` /
  `app.log.error({ err }, 'message')`.

Preserve existing message text where it's already useful; just upgrade
the API and add structured fields. Do **not** log request bodies, OAuth
codes, API keys, or session tokens (SPEC §14 — fields are explicit).

Acceptance: `rg "console\.(log|warn|error)" apps/server/src` returns
zero matches in `routes/`, `services/`, `plugins/`. Bootstrap and CLI
scripts are exempt.

### 10. Refund-path log line

In `apps/server/src/services/usage/charge.ts` (step 7), the `refund`
function should emit a structured INFO line:

```ts
request.log.info(
  { logId, action, amount, reason },
  'credits refunded',
);
```

Threaded as `logger` through the same pattern as task 5. Reason is a
short string ('llm_error' | 'timeout' | 'validation_error'). SPEC §10
covers refund semantics; this just makes the event observable.

### 11. Smoke-test the request-context binding

After tasks 1–2 land, hit `/api/health` from a new terminal and
verify the log line contains `requestId` and `userId: null`. Then hit
an authenticated route and verify `userId` is the session user's id.
This catches the common bug where the `request-context` plugin is
registered before the auth plugin and reads `req.session === undefined`.

### 12. Verify cost computation against a real call

Trigger a generation. Capture the resulting `llm call` log line and
compute `(tokens_in / 1e6) * 3.00 + (tokens_out / 1e6) * 15.00`
manually. Confirm it matches `cost_usd` to floating-point tolerance.

### 13. Verify the global IP rate limit

Use `curl` or `hey` to fire 70 requests at `/api/health` from a single
machine within 60s. The 61st should return 429 with `Retry-After`.
Confirm the body shape matches SPEC §14's intent.

### 14. Verify the per-user route limit

Sign in. From the browser DevTools console (or `curl` with the session
cookie), fire 11 `POST /api/games` requests in quick succession. The
11th should return 429 with `Retry-After`. Confirm in logs that the
`request completed` line for the 429 records `status: 429`.

### 15. Verify `LOG_LEVEL` honored

Restart with `LOG_LEVEL=warn`. Hit `/api/health`. No INFO line should
appear. Trigger a deliberate error (e.g. malformed body on a POST) —
ERROR line appears.

### 16. Verify `pino-pretty` toggled by `NODE_ENV`

Restart with `NODE_ENV=production`. Logs should emit raw JSON, one
object per line. Restart back to `NODE_ENV=development` and verify
colorized pretty output returns.

## Verification steps

Run all of these manually after the code lands. Dev server running.

1. **Health hit, 60+ in a minute, single IP → 429.**
   `for i in {1..70}; do curl -i http://localhost:3000/api/health; done`
   Expect ~10 of them to return 429 with `Retry-After` set to ~60s
   or less.

2. **User-scoped 10/min → 429.** Sign in. `for i in {1..12}; do
   curl -i --cookie 'better-auth.session_token=...' \
     -H 'Content-Type: application/json' \
     -d '{"prompt":"test"}' \
     http://localhost:3000/api/games; done`
   Expect the 11th and 12th to return 429 with `Retry-After`. (The
   first 10 may variously 200, 402, or 409 depending on credit and
   concurrency state — all that matters here is that the 11th is
   429 from the rate limiter, not from credits.)

3. **Correlated request + LLM logs.** Trigger a single generation.
   In the dev log, find the `request completed` line for `POST
   /api/games`. Note its `requestId`. There must be at least one
   matching `llm call` line with the same `requestId` and
   `cost_usd > 0`. For a generation with classification + title
   generation + embedding + Sonnet, expect 4 `llm call` lines all
   sharing the `requestId`.

4. **Refinement correlation.** Trigger a refinement that triggers
   summarization (current code > 2000 tokens, SPEC §16). Expect
   one request line plus two `llm call` lines (gpt-4.1-mini
   summarize + Sonnet refine), all sharing one `requestId`.

5. **Repair correlation.** Trigger an auto-repair (force a
   `game-error` per step 11). Expect one request line plus two
   `llm call` lines (gpt-4.1-mini categorize + Sonnet repair),
   all sharing one `requestId`.

6. **Error → ERROR with stack.** Force a 500 (e.g. temporarily
   throw inside a handler). Expect one ERROR line with the full
   stack as a `err.stack` field, plus one `request completed`
   INFO line at `status: 500`.

7. **Unauth `/api/health` logs `userId: null`.** Hit
   `/api/health` without cookies. The log line should show
   `userId: null` and a `requestId`.

8. **`LOG_LEVEL=warn` suppresses INFO.** Restart with
   `LOG_LEVEL=warn`. Hit `/api/health` (succeeds with 200). No
   INFO line should appear in stdout. Force an error → ERROR
   line still appears.

9. **`NODE_ENV=production` emits JSON.** Restart with
   `NODE_ENV=production`. Hit `/api/health`. Confirm log lines
   are valid JSON objects (one per line) with the expected
   fields.

10. **Cost math sanity.** Take any `llm call` line for Sonnet,
    extract `tokens_in`, `tokens_out`, `cost_usd`. Verify
    `cost_usd ≈ (tokens_in / 1e6) * 3.00 + (tokens_out / 1e6) *
    15.00`.

11. **No `console.*` in `routes/services/plugins`.**
    `rg 'console\.(log|warn|error)' apps/server/src/routes \
       apps/server/src/services apps/server/src/plugins`
    returns zero results.

12. **`Retry-After` present on 429.** Inspect any 429 response
    headers (e.g. via `curl -i` from steps 1 or 2). `Retry-After`
    is set to a positive integer in seconds.

13. **Admin user is rate-limited.** Sign in as an admin
    (email in `ADMIN_EMAILS`). Fire 11 `POST /api/games`
    requests. Expect 429 on the 11th — admins bypass credits
    (SPEC §10) but not rate limits (design Key decisions).

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — Structured logging + cost tracking

After tasks 1–5 and 9–10 complete (Pino bootstrap, `request-context` plugin, error-handler logging, price table + `computeCost`, threading `logger` through LLM helpers, replacing ad-hoc logging, refund-path log line) and the pre-commit gate passes:

```
feat(logging): structured pino logs with llm cost tracking
```

Includes: `apps/server/src/plugins/request-context.ts`, Pino bootstrap with `LOG_LEVEL` + `pino-pretty` gating, error handler updates, `MODEL_PRICES` + `computeCost` in `packages/shared/src/models.ts`, threaded `logger` through LLM helpers, and replacement of ad-hoc logging across the server.

### Checkpoint 2 — Rate limiting

After tasks 6–8 complete (install + register `@fastify/rate-limit`, route-scoped per-user policy on streaming endpoints, 429 + `Retry-After` shape) and the pre-commit gate passes:

```
feat(api): add fastify-rate-limit policies (60/ip global, 10/user-route)
```

Includes: `apps/server/src/plugins/rate-limit.ts`, route-scoped per-user limits on streaming endpoints, and the standardized 429 response with `Retry-After`.

## Rollback notes

- **Additive surface:**
  - `apps/server/src/plugins/request-context.ts`
  - `apps/server/src/plugins/rate-limit.ts`
  - New exports in `packages/shared/src/models.ts`: `MODEL_PRICES`,
    `computeCost`.
- **Modified surface:**
  - `apps/server/src/index.ts` — Pino options refined; new plugin
    registrations.
  - `apps/server/src/routes/games.ts` — per-route `config:
    { rateLimit: ... }` added on three handlers; `request.log`
    threaded into LLM helper calls.
  - `apps/server/src/services/llm/**.ts` — optional `logger`
    parameter on each helper; new INFO line on call completion.
  - `apps/server/src/services/**/*.ts` and route files — `console.*`
    swapped for `request.log.*` / `app.log.*`. Field shape only;
    no behavior change.
- **Schema:** none. No DB migration.
- **`@fastify/rate-limit` dependency:** added in `apps/server/package.json`.
  Removable by `bun remove`.
- **Reverting only the rate-limit plugin** removes both 60/min/IP
  and 10/min/user enforcement; credits and the 1-concurrent-stream
  cap (SPEC §14) remain. Product still functional.
- **Reverting only the request-context plugin** drops the
  `requestId`/`userId` child binding; logs become less useful but
  the app still runs. The `onResponse` line either disappears or
  reverts to Fastify's default (toggle `disableRequestLogging`
  back to `false`).
- **Reverting only the LLM cost-logging changes** removes the
  per-call `llm call` line; request-completion lines remain.
  Operator visibility into spend regresses to "estimate from
  request count × per-action SPEC §18 cost".
- **Price-table values are operator-tunable.** If provider list
  prices change, edit `MODEL_PRICES` in
  `packages/shared/src/models.ts` and restart. No other code
  touches list prices directly.

(End of file)
