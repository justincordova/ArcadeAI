# Operations

Notes for running ArcadeAI in production. This is intentionally light — the
deployment shape is a single Bun server + a Vite-built static SPA — but the
log-shipping decision matters early because we have no PostHog or other
analytics bolted on yet, so structured server logs are the only signal.

## Logs

The server uses Pino with structured JSON output (see `apps/server/src/index.ts`).
Every line carries `requestId` and (when authenticated) `userId`, plus the
fields below depending on origin:

| Source                                   | Notable fields                                                  |
| ---------------------------------------- | --------------------------------------------------------------- |
| `request-context.ts` (one per request)   | `route`, `method`, `status`, `duration_ms` (null when an earlier `onRequest` hook — CORS preflight, 429 — answered before timing started) |
| `services/llm/client.ts:logUsageOnDrain` | `model`, `tokens_in`, `tokens_out`, `duration_ms`, `cost_usd`   |
| `services/rag/retrieve.ts`               | `ragExampleId`, `similarity`, `genreFilter`, `fellBackToGlobal` |
| `services/usage/charge.ts` (refunds)     | `reason` (`abort` / `timeout` / `llm_error` / `persistence_error` / `stranded`) |
| `services/usage/reconcile.ts` (sweep)    | `found`, `refunded` — emitted at `warn` only when it actually reclaims rows |

That's enough to answer the questions we care about right now: who's
generating, what's it costing, and which RAG examples are getting picked.

A burst of `reason: "stranded"` right after a deploy is expected — it is the
sweep returning credits for streams the previous process was killed mid-flight.
A steady trickle at other times is not, and means processes are dying.

### Shipping options

We are not running a log shipper today. When we add one, the JSON-line shape
already works with all the obvious choices — pick the one that fits the host:

- **Loki + Grafana** — cheapest if you're self-hosting. Promtail on the box
  tails stdout, ships to Loki. Good fit for a single-VM deploy.
- **Datadog** — drop-in if the deploy is on a managed host. The Pino integration
  parses the JSON automatically. Cost scales with retention.
- **CloudWatch Logs** — default if we land on AWS. Logs Insights handles the
  JSON shape directly. Cheap until volume gets real.

Whatever we choose, the constraint is: don't break the JSON shape. No
`pino-pretty` in production (the dev transport already does the right thing
based on `NODE_ENV`).

### Local dev

`bun run dev` enables `pino-pretty` for human-readable output. Production
sticks to the raw JSON lines so the shipper gets clean structured data.

## Database

SQLite, single file at `DATABASE_PATH`. Backups today are a literal `cp` of
the file when no writes are in flight. WAL mode (set in `client.ts`) means
the `cp` may need to grab the `-wal` and `-shm` siblings too — better to use
`sqlite3 .backup` for hot snapshots.

`bun run db:studio` opens Drizzle Studio against the local DB.
`bun run db:migrate` runs pending migrations + post-migrate (sqlite-vec).

## CI

`.github/workflows/ci.yml` runs `bun install` → `bun run lint` → `bun run build`
→ `bun run test` on every push to `main` and every PR. Linux runner; the
macOS-only Homebrew-SQLite path in `packages/db/src/sqlite-vec-loader.ts` is
a no-op there, so no extra system packages are needed.

## Fly.io — Start / Stop / Deploy

ArcadeAI runs on a single Fly Machine. The app is on the Fly load balancer,
so `suspend` and `machines stop` are useless — incoming HTTP traffic wakes it
immediately. Use the scale commands instead.

### Stop the app (take it offline)

```bash
fly scale count 0
```

Removes the machine from the load balancer. No traffic reaches it, no billing
for compute. Visitors get a 503.

### Start the app (bring it back)

```bash
fly scale count 1
```

Spins up a new machine and reattaches it to the load balancer.

### Check status

```bash
fly machines list
fly status
```

### Redeploy (after pushing to main)

```bash
fly deploy
```

### Useful one-liners

```bash
fly logs                    # tail live logs
fly ssh console             # shell into the running machine
fly console                 # same thing, newer syntax
```

## Health

`GET /api/health` returns `200 { ok: true }`. Wire it as the orchestrator's
health probe; nothing else does.

## Graceful shutdown

`SIGTERM` / `SIGINT` triggers a 30-second drain window for active streams
before `app.close()`. Configured in `apps/server/src/index.ts`. If your
orchestrator's terminationGracePeriod is shorter than 30s, in-flight SSE
connections will be killed mid-frame and clients see truncated errors.
