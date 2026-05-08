import type { FastifyInstance } from "fastify";
import { sendError } from "../lib/errors.js";

/**
 * Defense-in-depth CSRF guard for `/api/*` (excluding `/api/auth/*`, which
 * Better Auth manages itself with its own origin checks).
 *
 * Real browsers issue cross-origin POSTs with arbitrary `Content-Type`
 * (form-encoded, multipart, text/plain) without firing a CORS preflight.
 * That makes a SameSite=Lax cookie + ad-hoc Origin check the only line of
 * defense — and the Origin header CAN be spoofed by a determined attacker
 * controlling the request. Requiring `Content-Type: application/json`
 * blocks the simple-request escape: the browser will preflight any request
 * with a non-simple Content-Type, which is gated by our CORS allow-list,
 * which only trusts WEB_ORIGIN.
 *
 * Returns 415 on mismatch, not 400, so the client can distinguish "your
 * payload was malformed" (400) from "your transport doesn't fit our
 * contract" (415).
 */
export function registerCsrfGuard(app: FastifyInstance) {
  const STATE_CHANGING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

  app.addHook("preHandler", async (request, reply) => {
    if (!STATE_CHANGING.has(request.method)) return;

    const path = request.url.split("?")[0];
    if (!path.startsWith("/api/")) return;
    if (path.startsWith("/api/auth/")) return;

    const ct = (request.headers["content-type"] ?? "").toString().toLowerCase();
    // Empty body POSTs (e.g. /api/games/:id/publish carries no payload but
    // is JSON-by-convention) often arrive without a content-type header.
    // Accept those — there's nothing for an attacker to gain by submitting
    // an empty form-encoded body.
    if (ct === "" && !request.headers["content-length"]) return;

    if (!ct.startsWith("application/json")) {
      return sendError(reply, 415, {
        code: "VALIDATION_ERROR",
        message: "Unsupported Media Type — application/json required",
      });
    }
  });
}
