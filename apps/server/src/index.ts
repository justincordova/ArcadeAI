import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { authPlugin, registerAuthGuard } from "./plugins/auth.js";
import { corsPlugin } from "./plugins/cors.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { registerRequestContext } from "./plugins/request-context.js";
import { billingRoutes } from "./routes/billing.js";
import { gamesRoutes } from "./routes/games.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";

const isDev = process.env.NODE_ENV === "development";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
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
await app.register(corsPlugin);
await app.register(registerRateLimit);
await app.register(authPlugin);
registerAuthGuard(app);
registerRequestContext(app);

// Global error handler — emit one structured ERROR line per uncaught
// failure. The onResponse hook in request-context still emits the
// per-request INFO line, so failed requests get exactly one ERROR + one
// INFO, sharing the same requestId. SPEC §14.
app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
  request.log.error({ err }, "request failed");
  const statusCode = err.statusCode ?? 500;
  if (statusCode >= 500) {
    return reply.status(statusCode).send({ error: "Internal Server Error" });
  }
  return reply.status(statusCode).send({ error: err.message });
});

// Routes
await app.register(healthRoutes);
await app.register(meRoutes);
await app.register(gamesRoutes);
await app.register(billingRoutes);

const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Server listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
