/**
 * Base URL for all server API requests. Defined once so changing the port
 * or host requires a single edit rather than updating every fetch call.
 *
 * Set `VITE_API_BASE` in `.env` (or in your hosting provider's build env)
 * to point at the deployed server origin. Defaults to localhost:3000 for
 * `bun run dev`. Set to "" (empty string) for same-origin deployments
 * where the SPA and API share a host — all fetches become relative.
 *
 * Vite inlines `import.meta.env.VITE_*` values at build time, so this
 * constant is baked into the bundle. Changing the API URL requires a
 * fresh build, not a runtime config.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

/**
 * Error thrown by {@link apiFetch} on any non-2xx response. Carries the
 * server's structured `{ code, message, details }` envelope (see
 * `apps/server/src/lib/errors.ts`) so callers can `switch (err.code)` rather
 * than parse `message` strings — `code` is the stable contract; `message` is
 * display copy that may change. `status` is the raw HTTP status for the rare
 * caller that needs it (e.g. distinguishing 402 from 409).
 *
 * When the body isn't a valid error envelope (network error page, empty
 * body, HTML), `code` falls back to `"INTERNAL_ERROR"` and `message` to a
 * generic string, so callers always get a well-formed error.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON-serializable request body. Serialized with JSON.stringify. */
  json?: unknown;
}

/**
 * Single fetch wrapper for all `/api/*` calls. Centralizes the four things
 * every call site used to repeat by hand:
 *
 *  1. `credentials: "include"` (cookie auth) on every request.
 *  2. `Content-Type: application/json` on state-changing requests — the CSRF
 *     guard (plugins/csrf.ts) rejects POST/PUT/PATCH/DELETE without it.
 *  3. An empty `"{}"` body for state-changing requests that carry no payload
 *     — Fastify's JSON parser rejects an empty body when the content-type is
 *     application/json.
 *  4. Parsing the server's `{ code, message, details }` error envelope on
 *     non-2xx and throwing a typed {@link ApiError} so callers can switch on
 *     `code` instead of discarding it behind `new Error("Failed to X")`.
 *
 * Returns the parsed JSON body typed as `T`. For 204/empty responses, pass
 * `T = void` and ignore the return value.
 */
export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const { json, headers, method, ...rest } = opts;
  const upperMethod = (method ?? "GET").toUpperCase();
  const isStateChanging = STATE_CHANGING.has(upperMethod);

  const finalHeaders = new Headers(headers);
  let body: BodyInit | undefined;
  if (json !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  } else if (isStateChanging) {
    // CSRF guard requires application/json; Fastify rejects an empty body, so
    // send a literal empty object for payload-less state changers.
    finalHeaders.set("Content-Type", "application/json");
    body = "{}";
  }

  // `rest` is spread first so passthrough options (signal, cache, ...) apply
  // without being able to clobber the four fields this wrapper exists to
  // guarantee — credentials, method, headers, body.
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    method: upperMethod,
    headers: finalHeaders,
    body,
  });

  if (!res.ok) {
    throw await toApiError(res);
  }

  // 204 No Content (or any empty body) — return undefined, typed as T.
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (text === "") {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

/**
 * Read a non-2xx Response into a typed {@link ApiError}, tolerating bodies
 * that aren't valid error envelopes (HTML error pages, empty bodies).
 */
export async function toApiError(res: Response): Promise<ApiError> {
  let code = "INTERNAL_ERROR";
  let message = `Request failed (${res.status})`;
  let details: Record<string, unknown> | undefined;
  try {
    const raw = (await res.json()) as Partial<{
      code: string;
      message: string;
      details: Record<string, unknown>;
    }>;
    if (typeof raw.code === "string") code = raw.code;
    if (typeof raw.message === "string") message = raw.message;
    if (raw.details && typeof raw.details === "object") details = raw.details;
  } catch {
    // Body wasn't JSON (e.g. an upstream HTML error page) — keep fallbacks.
  }
  return new ApiError(res.status, code, message, details);
}
