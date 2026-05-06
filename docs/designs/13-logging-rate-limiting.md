# 13 — Logging + Rate Limiting Polish

## Overview

Step 13 is a **polish step**. Fastify is already initialized with Pino
in step 1 (SPEC §3, §19), and `pino-pretty` is wired for dev. CORS, the
unauthenticated `/api/health` route, and the per-request log line that
Fastify emits by default have all been in place since the scaffold.
This step does not introduce a new transport, library, or framework.

What it formalizes:

- A **request-context plugin** that attaches `{ requestId, userId }` to
  a Fastify child logger so every log line emitted during a request
  carries the same correlation fields (SPEC §14).
- The **per-request log shape** mandated by SPEC §14 —
  `requestId, userId, route, method, status, duration_ms` — emitted on
  request completion, with errors at ERROR with full stack.
- **LLM observability:** every Sonnet / GPT-4.1-mini / embedding call
  emits a separate log line with the *same* `requestId` for
  correlation: `requestId, model, tokens_in, tokens_out, duration_ms,
  cost_usd` (SPEC §14). `cost_usd` is computed from a per-token price
  table extension to `packages/shared/src/models.ts`, keyed by model
  name (SPEC §3, §14).
- **Rate limiting** via `@fastify/rate-limit` with an in-memory store
  (SPEC §3, §14): a global per-IP cap of **60 req/min on all `/api/*`**,
  and a route-scoped per-user cap of **10 req/min** on the three
  generation/refinement/repair endpoints. 429 responses include a
  `Retry-After` header (SPEC §14).
- **`LOG_LEVEL`** env var honored end-to-end (SPEC §15). `pino-pretty`
  enabled only when `NODE_ENV=development` (SPEC §3, §15).

The new surface is small. The bulk of the work is replacing scattered
ad-hoc logging in the LLM and route layers with structured Pino calls
that flow through `request.log` (the request-scoped child logger), and
adding two configuration objects to the rate-limit plugin.

## Goals

- Single `request-context` plugin attaches `{ requestId, userId }` to
  `request.log` as a child logger. Every downstream log emitted via
  `request.log.{info,warn,error}` inherits these fields automatically
  (SPEC §14).
- `requestId` generated once per inbound request (use Fastify's built-in
  `genReqId` configured to a short uuid/nanoid form). `userId` resolved
  from the Better Auth session at the same hook site that the auth
  middleware already runs (step 2). Unauthenticated requests log
  `userId: null`.
- Per-request completion log line includes
  `requestId, userId, route, method, status, duration_ms` (SPEC §14).
  This piggybacks on Fastify's built-in `onResponse` hook to compute
  `duration_ms = Date.now() - request.startTime`.
- Errors flow through Fastify's error handler and log at ERROR with the
  full stack (SPEC §14). The error handler also emits a normal response
  log line so the per-request shape is uniform.
- LLM service emits a structured log line per upstream call with
  `requestId, model, tokens_in, tokens_out, duration_ms, cost_usd`
  (SPEC §14). The line is emitted via `request.log.info` so the
  `requestId` is automatically present and matches the request log
  line.
- `cost_usd` computed from a per-token price table living in
  `packages/shared/src/models.ts` next to the model IDs (SPEC §3).
  Token counts come from the AI SDK's `usage` object returned by
  `streamText` / `generateText` (already used in steps 4, 6, 10, 11).
- `@fastify/rate-limit` registered globally with **60 req/min/IP** on
  all `/api/*` routes (SPEC §3, §14).
- A second, **route-scoped** rate-limit policy of **10 req/min/user**
  applied to:
  - `POST /api/games`
  - `POST /api/games/:id/refine`
  - `POST /api/games/:id/repair`
  This is defense-in-depth on top of the credit checks (SPEC §10, §14)
  and the 1-concurrent-stream cap (SPEC §14). Keying is by
  `session.user.id`; unauthenticated requests on these routes are
  already 401 from auth middleware (SPEC §14).
- 429 response shape: standard `@fastify/rate-limit` body
  (`{ statusCode: 429, error: 'Too Many Requests', message }`) plus a
  `Retry-After` header in seconds (SPEC §14).
- `LOG_LEVEL` env var (SPEC §15) read at server bootstrap and passed to
  Pino. Default `info` per `.env.example`. `pino-pretty` transport
  attached **only** when `NODE_ENV=development` (SPEC §3, §15).
- All ad-hoc `console.log` / `console.warn` / `console.error` in
  `apps/server/src/services/**` and `apps/server/src/routes/**`
  replaced with `request.log.{info,warn,error}` (or `app.log` where no
  request scope exists, e.g. bootstrap). Any structured log fields
  follow the schema above.

## Non-goals

- **No log shipping.** Logs go to stdout. No file rotation, no syslog,
  no external collector. Operator reads with `tail` or pipes through
  `pino-pretty` outside the dev server.
- **No APM, no metrics endpoint, no Prometheus.** Cost and latency
  visibility comes from grepping Pino lines, not from a `/metrics`
  scrape.
- **No distributed tracing.** Single-process prototype (SPEC §1). A
  shared `requestId` correlating request log + LLM log is sufficient.
  No OpenTelemetry, no W3C trace context.
- **No Redis-backed rate limiter, no clustered store.** SPEC §3
  specifies "in-memory store". Multi-instance scaling is explicitly
  out of scope (SPEC §2).
- **No per-tier rate limit variation.** Free / Creator / Pro / Admin
  share the same 60/min/IP and 10/min/user caps. Tier-specific quotas
  are already enforced by the credit model (SPEC §10), and SPEC §14
  describes only the two flat policies. Admin is *not* exempted from
  rate limiting (the cap protects the LLM provider and our own
  process, not the operator's wallet).
- **No log sampling.** Every request and every LLM call gets a line.
  Volume in a local prototype is trivial.
- **No structured request body logging.** Bodies may contain user
  prompts that are noisy and large; we log route, method, status,
  duration only (SPEC §14). Bodies remain off-record by default.
- **No retry-counter or backoff coordination across requests.**
  `@fastify/rate-limit`'s default sliding window is acceptable.
- **Not refactoring the LLM client surface.** The cost-logging hook
  threads through the existing `streamGame` / `streamRefinement`
  / `streamRepair` / `categorizeError` helpers. No new client class
  layer.

## Architecture

### Pino configuration

`apps/server/src/index.ts` (Fastify bootstrap, from step 1) constructs
the Fastify instance with:

```ts
const isDev = process.env.NODE_ENV === 'development';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(isDev
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
    // omit per-request body/headers from the default serializers
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  },
  genReqId: () => randomUUID(), // short, collision-free per process
  disableRequestLogging: true,   // we emit our own onResponse line
});
```

`disableRequestLogging: true` suppresses Fastify's default
`incoming request` / `request completed` lines so we control the
exact shape (SPEC §14). Replaced by an explicit `onResponse` hook
below.

### `request-context` plugin

`apps/server/src/plugins/request-context.ts`. Registered early in
the plugin order, after the auth plugin (step 2) so the session is
already attached.

```ts
app.addHook('onRequest', (req, _reply, done) => {
  req.startTime = Date.now();
  // child logger with stable correlation fields
  req.log = req.log.child({
    requestId: req.id,
    userId: req.session?.user?.id ?? null,
  });
  done();
});

app.addHook('onResponse', (req, reply, done) => {
  req.log.info(
    {
      route: req.routeOptions.url ?? req.url,
      method: req.method,
      status: reply.statusCode,
      duration_ms: Date.now() - req.startTime,
    },
    'request completed',
  );
  done();
});
```

The `userId` resolution must happen **after** the auth hook, which
already runs on `preHandler`. Two acceptable orderings:

1. Re-attach the child logger in a `preHandler` hook *after* auth.
2. Read `req.session` lazily in the `onResponse` line and skip the
   `onRequest` child rebind.

Default position: option 1. Rebinding `req.log` once after auth
guarantees that any `request.log.info` calls in route handlers carry
`userId` without each call site reading the session.

`req.session` is populated by Better Auth's middleware (step 2). For
unauthenticated routes (`/api/health`, `/api/auth/*`), `userId` is
`null`.

### LLM service: cost + token logging

`apps/server/src/services/llm/client.ts` already wraps Sonnet and
GPT-4.1-mini calls. Each helper (`streamGame`,
`streamRefinement`, `streamRepair`, `categorizeError`,
`classifyGenre`, `summarizeForRefinement`, `embedPrompt`,
`generateTitle`) gains a `logger?: FastifyBaseLogger` parameter
threaded from the route handler.

Inside each helper, around the AI SDK call:

```ts
const start = Date.now();
const result = await streamText({ model, system, messages, abortSignal });
// ...consume stream...
const usage = await result.usage; // AI SDK exposes input/output tokens
const duration_ms = Date.now() - start;
const cost_usd = computeCost({ model: MODEL_ID, usage });
logger?.info(
  {
    model: MODEL_ID,
    tokens_in: usage.promptTokens,
    tokens_out: usage.completionTokens,
    duration_ms,
    cost_usd,
  },
  'llm call',
);
```

The `requestId` and `userId` are inherited automatically because
`logger` is the per-request child from `request-context`. SPEC §14:
"LLM calls logged separately with the same `requestId` for
correlation."

For streaming calls, the log line is emitted on stream completion (or
on error), not on each chunk.

### Price table in `packages/shared/src/models.ts`

`models.ts` already pins model IDs (SPEC §3). Extended with a
per-million-token price table keyed by model ID:

```ts
export const MODELS = {
  sonnet:   'claude-sonnet-4-6',
  opus:     'claude-opus-4-7',
  miniGPT:  'gpt-4.1-mini',
  embed:    'text-embedding-3-small',
} as const;

// USD per 1,000,000 tokens. Source: provider list prices at time of
// build. Update alongside model ID changes.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.00,  output: 15.00 },
  'claude-opus-4-7':   { input: 15.00, output: 75.00 },
  'gpt-4.1-mini':      { input: 0.40,  output: 1.60 },
  'text-embedding-3-small': { input: 0.02, output: 0.0 }, // embeddings have no completion tokens
};

export function computeCost({
  model,
  usage,
}: {
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0; // unknown model → log 0 rather than crash
  return (
    (usage.promptTokens / 1_000_000) * price.input +
    (usage.completionTokens / 1_000_000) * price.output
  );
}
```

Numbers are rough list prices; the *contract* is the schema. Operator
updates the values when providers change pricing. SPEC §14 only
specifies that `cost_usd` exists and comes from a per-token table in
this file.

`computeCost` returns a JS number rounded to ~6 decimal places by the
caller if desired. We keep it as a raw float in the log line; Pino's
JSON serializer handles it fine, and `pino-pretty` displays it
readably.

### Rate-limit plugin

`apps/server/src/plugins/rate-limit.ts`. Registered after CORS and
auth, before route registration.

```ts
import rateLimit from '@fastify/rate-limit';

await app.register(rateLimit, {
  global: true,
  max: 60,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
  // Attach Retry-After. SPEC §14.
  // @fastify/rate-limit sets it by default; declared here for clarity.
  hook: 'onRequest',
});
```

This applies to **every** `/api/*` route, including `/api/health` and
`/api/auth/*`. Per SPEC §14 the global cap is 60/min/IP on all
`/api/*` — no exemptions called out.

### Route-scoped per-user policy

For the three streaming endpoints, a second policy is attached at
route registration time using `@fastify/rate-limit`'s per-route config
hook:

```ts
const perUserGen = {
  max: 10,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.session?.user?.id ?? req.ip,
};

app.post('/api/games', { config: { rateLimit: perUserGen } }, generateHandler);
app.post('/api/games/:id/refine', { config: { rateLimit: perUserGen } }, refineHandler);
app.post('/api/games/:id/repair', { config: { rateLimit: perUserGen } }, repairHandler);
```

Falling back to `req.ip` when `session?.user?.id` is missing is
defensive — the auth middleware should have already 401'd those
requests. The fallback prevents an authenticated route from ever
keying on `undefined`.

The 60/min/IP global cap and the 10/min/user route cap are evaluated
**both**, independently — `@fastify/rate-limit` composes per-route
config with the global config, taking the stricter outcome where they
overlap. Either limit firing returns 429.

### 429 response

Default `@fastify/rate-limit` 429 body:

```json
{ "statusCode": 429, "error": "Too Many Requests", "message": "Rate limit exceeded, retry in <N> seconds" }
```

`Retry-After` header set to the seconds remaining in the window
(SPEC §14). No customization needed.

### Replacing ad-hoc logging

A pass through `apps/server/src/{routes,services,plugins}/**.ts`
replaces every `console.log` / `console.warn` / `console.error` with
`request.log.{info,warn,error}` where a request scope exists, or
`app.log` for bootstrap and background tasks. Examples:

- Genre classifier fallback (step 10): `console.warn(...)` →
  `request.log.warn({ raw: rawResponse }, 'genre classify failed; defaulting to other')`.
- Repair categorizer fallback (step 11): same shape with
  `'category classify failed; defaulting to runtime'`.
- LLM API errors caught in the streaming routes log at ERROR with the
  caught error's stack (Pino serializes `err` automatically when
  passed as the field).

No log line should leak secrets (API keys, session tokens, OAuth
codes). `serializers.req` already strips headers; service-layer logs
only include the structured fields enumerated above plus diagnostic
text.

### Log levels

- `info`: per-request completion, LLM call, normal lifecycle events.
- `warn`: classifier fallbacks, recoverable validation issues.
- `error`: unhandled exceptions, LLM provider errors that fail the
  request, refund operations on credit refund paths (step 7).
- `debug`: not used by default. `LOG_LEVEL=debug` allows verbose
  per-chunk traces if added ad-hoc during debugging.

`LOG_LEVEL` is read once at bootstrap (SPEC §15). Pino does not
support runtime level changes by default; restart to change.

## Key decisions

- **Per-IP global + per-user route-scoped — defense in depth on top
  of credit checks.** Credits (SPEC §10) are the right primary
  guardrail for cost; rate limits are the secondary guardrail against
  bursts (e.g. a buggy client retry loop before the credit decrement
  has time to land, or an unauthenticated abuser hitting `/api/auth`
  endpoints). The two layers are independent: rate limiting fires
  before any DB read, credits fire after auth. SPEC §14 explicitly
  describes both layers.
- **In-memory store for the rate limiter.** SPEC §3 specifies it,
  SPEC §1 frames the system as a single-process local prototype, and
  Redis would add an operational dependency for no benefit. If the
  app is ever scaled to multiple instances, swap the store; the
  surface in `@fastify/rate-limit` is identical.
- **Log LLM cost in USD.** Operator visibility into spend (SPEC §14,
  §18). Token counts alone require mental math against the price
  table; pre-computing `cost_usd` per call lets a simple `pino-pretty
  | grep "llm call"` produce a readable spend log. The price table
  lives in `packages/shared` next to model IDs so a single edit
  updates both runtime model selection and cost reporting (SPEC §3).
- **`pino-pretty` only in dev.** SPEC §3. JSON in production-style
  runs (even though we don't deploy, JSON is the only format that
  composes with downstream tools). `NODE_ENV` is the single switch.
- **`requestId` is the correlation key.** Both the request-completion
  line and every LLM line emitted during that request share it. This
  is the cheapest possible alternative to distributed tracing and
  satisfies SPEC §14 directly.
- **Logger threaded as a parameter, not pulled from AsyncLocalStorage.**
  Explicit threading from route handlers into LLM service helpers is
  a small chore but keeps the data flow visible. AsyncLocalStorage
  would work but adds a non-obvious magic field. The cost is one
  optional parameter on a handful of helpers.
- **`disableRequestLogging: true` + custom `onResponse` line.**
  Fastify's default request log emits two lines per request
  (`incoming` + `request completed`) with a fixed shape that doesn't
  match SPEC §14. Disabling it and emitting one structured line keeps
  log volume sane and the shape exact.
- **No body logging.** SPEC §14 enumerates fields explicitly; bodies
  aren't on the list. Prompts can be long, may contain PII in the
  general case, and would balloon log size. Drop them.
- **Admin not exempt from rate limiting.** Admin bypasses *credits*
  (SPEC §10) but the rate limiter protects the *process and the
  upstream provider*. A misbehaving admin client would happily DoS
  the LLM provider. SPEC §14 describes flat caps with no admin
  carve-out.
- **Route-scoped policy keyed by `session.user.id`, not IP.** Two
  users behind one NAT must not share a per-user budget. SPEC §14
  says "10 req/min per user" — the keying must reflect that.
- **No tier-based variation.** SPEC §14 lists one route-scoped
  number. Per-tier limits would couple rate limiting to plan
  config and complicate the limiter for marginal benefit; tier
  enforcement already happens via credit allotment (SPEC §10).
- **Cost-table format: per-million tokens with `input`/`output`
  split.** Matches the de-facto vendor pricing format (Anthropic
  and OpenAI both list per-million USD with separate input/output
  rates) and lets `computeCost` read directly without conversion
  factors. SPEC §14 says only "per-token price table"; per-million
  is a presentational choice.
- **Embeddings priced as input-only.** `text-embedding-3-small`
  has no completion tokens; storing `output: 0` in the price
  table makes `computeCost` work uniformly without a special
  embeddings code path.

## Open questions

- **Where exactly to thread the request logger into LLM helpers.**
  Two patterns: (a) optional `logger?: FastifyBaseLogger` on each
  helper, or (b) a small `LLMContext` object passed once per
  request-scoped service handle. Default position: (a) — minimal
  surface change, matches current style. Resolve in plan.
- **`requestId` length / format.** `randomUUID()` is ~36 chars,
  noisy in `pino-pretty`. Could swap to a 12-char nanoid for
  readability. Default position: keep `randomUUID()` for the first
  pass; revisit if dev logs become hard to scan.
- **Unit cost rounding.** Log `cost_usd` as a raw float, or round to
  6 decimals before logging? Default position: raw float; the JSON
  consumer can format. SPEC §14 doesn't constrain.
- **Should `/api/health` be exempt from the global rate limit?**
  Liveness checkers may hit it more than 60/min/IP if multiple
  checkers share an IP. SPEC §14 says "all `/api/*`" with no
  exception. Default position: no exemption; health checkers in
  this prototype are the developer hitting `curl` and won't hit
  60/min. Resolve in plan if needed.
- **Refund-path log level.** A credit refund (SPEC §10) is a normal
  business event when the LLM provider errors out. INFO or WARN?
  Default position: INFO with structured fields, no special
  treatment beyond shape consistency. Resolve in plan.

## Acceptance criteria

1. Hitting any `/api/*` route 60+ times in one minute from a single
   IP returns 429 with a `Retry-After` header.
2. Logged-in user posting `POST /api/games` 10+ times in one minute
   returns 429 on the 11th attempt with `Retry-After`. The same
   user from a different IP also gets 429 on the 11th attempt
   (key is `userId`, not IP).
3. Hitting `POST /api/games/:id/refine` and `POST /api/games/:id/repair`
   exhibits the same per-user 10/min behavior (the policy applies to
   the union of those three routes per user — this is implementation-
   detail-dependent on `@fastify/rate-limit`; if the lib counts
   per-route instead of per-policy, the criterion is restated as
   "10/min per route per user", which still satisfies SPEC §14's
   defense-in-depth intent).
4. A normal generation request produces **two** log lines with the
   same `requestId`:
   - `request completed` with `route, method, status, duration_ms,
     userId`.
   - `llm call` with `model, tokens_in, tokens_out, duration_ms,
     cost_usd > 0`.
5. A refinement request produces a request log line + an `llm call`
   line for Sonnet, and (when summarization triggers per SPEC §16)
   an additional `llm call` line for `gpt-4.1-mini` — all sharing
   one `requestId`.
6. A repair request (SPEC §7, §11) produces three correlated log
   lines: request line + `gpt-4.1-mini` categorize line + Sonnet
   repair line, all sharing one `requestId`.
7. An unhandled exception inside a route handler logs at ERROR with
   a full stack and produces a 500 response. The standard
   `request completed` line is also emitted at the right `status`.
8. Setting `LOG_LEVEL=warn` suppresses `info` lines (request and
   LLM lines disappear); ERROR still emits.
9. Setting `NODE_ENV=production` (and unsetting it back to
   `development` for local dev) toggles `pino-pretty` off / on.
   JSON lines should be valid JSON in production mode.
10. `cost_usd` for a Sonnet call with known token counts matches
    `(tokens_in / 1e6) * 3.00 + (tokens_out / 1e6) * 15.00` to
    floating-point tolerance.
11. `request.log` calls inside service modules carry `requestId`
    and `userId` without explicit fields at the call site (i.e.
    the child-logger binding from `request-context` actually
    propagates).
12. Unauthenticated requests to `/api/health` log `userId: null`
    on the request line. They are rate-limited by IP only (no
    per-user route policy applies — `/api/health` is not in the
    route-scoped list).
13. No remaining `console.log` / `console.warn` / `console.error`
    calls in `apps/server/src/{routes,services,plugins}` after
    this step. `app.log` may appear in bootstrap code.
14. The price table in `packages/shared/src/models.ts` has an
    entry for every runtime model in the `MODELS` constant.
    `computeCost` returns a finite number for each.

(End of file)
