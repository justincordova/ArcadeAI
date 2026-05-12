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
    // Return the canonical ApiError shape `{ code, message, details? }`
    // so the frontend's switch-on-code logic (see lib/errors.ts and
    // the SPEC §14 contract) handles 429 like every other error. The
    // previous body shape was `{ statusCode, error, message }` — none
    // of those field names match the contract, so the client surfaced
    // 429s as generic stream errors with no retry guidance.
    errorResponseBuilder: (_req: FastifyRequest, ctx: RateLimitContext) => ({
      code: "RATE_LIMITED",
      message: `Rate limit exceeded. Retry in ${ctx.after}.`,
      details: { retryAfter: ctx.after },
    }),
  });
}
