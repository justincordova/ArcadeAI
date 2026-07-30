import type { FastifyRequest } from "fastify";

/**
 * Resolve the path that request guards (auth, CSRF) should match against.
 *
 * Guards MUST NOT match on `request.url`. Fastify's router (find-my-way)
 * percent-decodes the path before matching routes, so the raw URL and the
 * route the request actually reaches can disagree. `GET /%61pi/me` (`%61` =
 * `a`) does not start with `/api/`, so a raw-URL guard skips it entirely —
 * yet the router still dispatches it to the `/api/me` handler. That
 * desynchronization bypassed both the auth guard and the CSRF Content-Type
 * guard.
 *
 * `request.routeOptions.url` is the *matched route pattern* (e.g.
 * `/api/play/:slug`), produced by the router after decoding. It cannot be
 * desynchronized from the handler that will run, so encoding tricks have no
 * effect on it.
 *
 * Falls back to the raw path only when no route matched (404), where there is
 * no handler to reach and therefore nothing to protect.
 */
export function guardPath(request: FastifyRequest): string {
  return request.routeOptions?.url ?? request.url.split("?")[0];
}
