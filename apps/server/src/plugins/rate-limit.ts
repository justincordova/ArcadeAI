import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";

interface RateLimitContext {
  after: string;
}

/**
 * Global IP-based rate limit (60 req/min) plus per-route per-user limits on
 * streaming endpoints (10 req/min). Both limits are evaluated; stricter wins.
 * SPEC §14 — defense in depth on top of credit enforcement.
 *
 * Called directly on the root app (not via `app.register`) so the
 * fastify-plugin-wrapped @fastify/rate-limit is registered at the root
 * encapsulation scope. Wrapping in another plain plugin would re-encapsulate
 * the rate-limit hooks and they would never fire on top-level routes.
 */
export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: 60,
    timeWindow: "1 minute",
    keyGenerator: (req: FastifyRequest) => req.ip,
    // onRequest runs before auth, so unauthenticated endpoints are rate-limited too
    hook: "onRequest",
    errorResponseBuilder: (_req: FastifyRequest, ctx: RateLimitContext) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Rate limit exceeded, retry in ${ctx.after}`,
    }),
  });
}
