import type { FastifyReply } from "fastify";

/**
 * Standard structured error body returned by all `/api/*` routes.
 *
 * Frontend handlers should switch on `code` rather than parsing `message`
 * strings — codes are stable contracts; messages are display copy and may
 * change.
 *
 * `details` carries case-specific data (e.g. `{ resetAt, kind }` for quota
 * errors, `{ field, reason }` for validation). Optional and never required
 * to be populated.
 */
export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Closed set of error codes. Adding a new one is a contract change — bump
 * this list and the frontend's error-code switch in lockstep.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_CREDITS"
  | "FREE_TIER_EXHAUSTED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export function sendError(reply: FastifyReply, status: number, error: ApiError): FastifyReply {
  return reply.status(status).send(error);
}

// Convenience constructors for the most common cases. Callers can also build
// ApiError objects by hand when they need custom `details`.

export function validationError(message: string, details?: Record<string, unknown>): ApiError {
  return { code: "VALIDATION_ERROR", message, details };
}

export function notFoundError(message = "Not found"): ApiError {
  return { code: "NOT_FOUND", message };
}

export function conflictError(message: string): ApiError {
  return { code: "CONFLICT", message };
}

export function unauthorizedError(message = "Unauthorized"): ApiError {
  return { code: "UNAUTHORIZED", message };
}

export function quotaError(
  message: string,
  details: { resetAt: number; kind: "daily" | "monthly" | "lifetime" }
): ApiError {
  // FREE_TIER_EXHAUSTED is the lifetime hard-cap; daily/monthly windows are
  // INSUFFICIENT_CREDITS so the client can render a reset countdown.
  return {
    code: details.kind === "lifetime" ? "FREE_TIER_EXHAUSTED" : "INSUFFICIENT_CREDITS",
    message,
    details,
  };
}
