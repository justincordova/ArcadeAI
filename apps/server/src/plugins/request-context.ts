import type { FastifyInstance, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    // Optional: an earlier root-scope onRequest hook (CORS preflight,
    // rate-limit rejection) can answer the request before this plugin's own
    // onRequest runs, so it is not guaranteed to be set by onResponse time.
    startTime?: number;
  }
}

/**
 * Attaches per-request structured logging context per SPEC §14:
 * - requestId and userId are bound as child logger fields.
 * - Emits a single INFO line per completed request: route, method, status, duration_ms.
 *
 * Called as a plain function (not via `app.register`) so its hooks attach
 * to the root encapsulation context and apply to every route — including
 * plugin-registered ones. Fastify plugins encapsulate by default, which is
 * why this isn't an `await app.register(...)` callback.
 *
 * Must be invoked AFTER the auth guard so `request.authSession.user.id`
 * is populated when the preHandler reads it.
 */
export function registerRequestContext(app: FastifyInstance) {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    request.startTime = Date.now();
  });

  app.addHook("preHandler", async (request: FastifyRequest) => {
    const userId =
      (request as FastifyRequest & { authSession?: { user?: { id?: string } } }).authSession?.user
        ?.id ?? null;

    request.log = request.log.child({
      requestId: request.id,
      userId,
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    // Root-scope onRequest hooks run in registration order and the chain stops
    // as soon as one replies. registerCors and registerRateLimit are both
    // registered before this plugin, so a CORS preflight or a 429 is answered
    // before startTime is ever set — `Date.now() - undefined` logged NaN,
    // which pino serializes to null. onResponse still fires for those, so emit
    // the line without a duration rather than a bogus one.
    request.log.info(
      {
        route: request.routeOptions?.url ?? request.url,
        method: request.method,
        status: reply.statusCode,
        duration_ms: request.startTime === undefined ? null : Date.now() - request.startTime,
      },
      "request completed"
    );
  });
}
