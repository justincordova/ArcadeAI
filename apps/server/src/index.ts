import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { activeCount, clear as clearActiveStreams } from "./lib/active-streams.js";
import { db, sqlite } from "./lib/db.js";
import { loadEnv } from "./lib/env.js";
import { authPlugin, registerAuthGuard } from "./plugins/auth.js";
import { registerCors } from "./plugins/cors.js";
import { registerCsrfGuard } from "./plugins/csrf.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { registerRequestContext } from "./plugins/request-context.js";
import { billingRoutes } from "./routes/billing.js";
import { discoverRoutes } from "./routes/discover.js";
import { gamesRoutes } from "./routes/games.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { ogRoutes } from "./routes/og.js";
import { playRoutes } from "./routes/play.js";

// Validate env vars first so misconfiguration fails fast with a clear message
// instead of surfacing as a 30-second-later 401 on an AI call.
const env = loadEnv();
const isDev = env.NODE_ENV === "development";

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true },
          },
        }
      : {}),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  },
  genReqId: () => randomUUID(),
  disableRequestLogging: true,
  // Behind a reverse proxy/LB, derive req.ip from X-Forwarded-For so the
  // IP-based rate limiter keys on real client IPs rather than the proxy's
  // address (which would make the global cap a server-wide limit and 429
  // every user). Gated by env so a directly-exposed server doesn't trust
  // spoofable forwarding headers.
  trustProxy: env.TRUST_PROXY,
});

// Plugins and hooks. Encapsulation note: hooks added inside
// `app.register(plugin)` only apply within that plugin's scope. The auth
// guard and request-context hooks need to apply to ALL routes (including
// those registered later via plugins), so they're attached directly to
// the app via `registerAuthGuard` / `registerRequestContext`, which
// internally call `app.addHook` at the root scope.
//
// Order:
//   1. CORS — outermost.
//   2. Rate limit — global IP cap, runs at onRequest (before auth).
//   3. Auth /api/auth/* delegate plugin (Better Auth handler).
//   4. Auth guard hook — populates `request.authSession` for /api/*.
//   5. Request-context hook — must run AFTER auth so it can bind userId.
// Decorate the DB handles onto the app so handlers/services can pull them
// from `request.server.db` rather than the import-time singleton. The
// singleton remains for code that needs the DB at module-load time (e.g.
// Better Auth construction). Tests can override these decorators by
// constructing the app against an in-memory DB.
app.decorate("db", db);
app.decorate("sqlite", sqlite);

await registerCors(app);
await registerRateLimit(app);
await app.register(authPlugin);
registerAuthGuard(app);
// CSRF guard runs AFTER auth so it benefits from the same auth-exempt path
// list (the guard itself excludes /api/auth/* — Better Auth handles its
// own anti-CSRF). Sits before request-context since 415s should still log
// the userId if available.
registerCsrfGuard(app);
registerRequestContext(app);

// Global error handler — emit one structured ERROR line per uncaught
// failure. The onResponse hook in request-context still emits the
// per-request INFO line, so failed requests get exactly one ERROR + one
// INFO, sharing the same requestId. SPEC §14.
//
// Errors that DO reach this handler are ones a route did NOT format with
// `sendError(...)` — Fastify-native body-parser failures, automatic
// 404 not-found, route-handler exceptions, etc. We map the HTTP status
// back to a canonical `ErrorCode` so the frontend's `switch (body.code)`
// works uniformly; the previous code unconditionally returned
// VALIDATION_ERROR for any 4xx, which broke client-side branching on
// 404 / 415 / etc.
//
// Messages on 5xx are scrubbed to "Internal Server Error" so we don't
// leak stack snippets or upstream library internals. 4xx messages are
// kept (they're typically zod / body-parser one-liners the client can
// surface), except for the catchall NOT_FOUND / UNAUTHORIZED cases where
// we substitute a stable string.
import { codeForStatus } from "./lib/errors.js";

app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
  request.log.error({ err }, "request failed");
  const statusCode = err.statusCode ?? 500;
  const code = codeForStatus(statusCode);

  let message: string;
  if (statusCode >= 500) {
    message = "Internal Server Error";
  } else if (code === "NOT_FOUND") {
    message = "Not found";
  } else if (code === "UNAUTHORIZED") {
    message = "Unauthorized";
  } else if (code === "RATE_LIMITED") {
    // @fastify/rate-limit's errorResponseBuilder formats its own body
    // and shouldn't reach this handler; fall back to a generic message.
    message = "Rate limit exceeded";
  } else {
    message = err.message || "Request failed";
  }

  return reply.status(statusCode).send({ code, message });
});

// Routes
await app.register(healthRoutes);
await app.register(meRoutes);
await app.register(gamesRoutes);
await app.register(playRoutes);
await app.register(discoverRoutes);
await app.register(ogRoutes);
await app.register(billingRoutes);

const webDistPath = new URL("../../web/dist", import.meta.url).pathname;
if (existsSync(webDistPath)) {
  await app.register(fastifyStatic, {
    root: webDistPath,
    wildcard: false,
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api")) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Not found" });
    }
    // biome-ignore lint/suspicious/noExplicitAny: fastify-static augments FastifyReply at runtime
    return (reply as any).sendFile("index.html");
  });
}

const port = env.PORT;

// Defense-in-depth: any locks held by a crashed previous run cannot survive
// across processes (the Set is module-scoped), but explicitly clearing makes
// the invariant obvious in startup logs and is safe for tests.
clearActiveStreams();

try {
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Server listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown: on SIGTERM/SIGINT, stop accepting new requests, wait
// briefly for in-flight streaming work to drain, then exit. Without this,
// active SSE connections are killed mid-frame and clients see truncated
// errors. The 30-second cap matches typical orchestrator drain windows.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal, activeStreams: activeCount() }, "shutdown signal received");

  const drainDeadline = Date.now() + 30_000;
  while (activeCount() > 0 && Date.now() < drainDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (activeCount() > 0) {
    app.log.warn({ remaining: activeCount() }, "drain deadline reached; forcing close");
  }

  try {
    await app.close();
    app.log.info("server closed cleanly");
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
