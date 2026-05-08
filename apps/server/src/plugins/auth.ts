import type { FastifyInstance, FastifyRequest } from "fastify";
import { auth } from "../lib/auth.js";

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

// Headers that must not be forwarded from the original Fastify request to the
// reconstructed Web Request: hop-by-hop or connection-scoped, plus host (the
// reconstructed URL has its own host) and content-length (we recompute the
// body bytes so the original length may not match).
const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "content-length",
]);

// Response headers we must strip before forwarding to the client because Node's
// http response will recompute them based on the buffer we write. Keeping the
// originals would corrupt the response (especially content-encoding, since we
// already decoded the body via response.arrayBuffer()).
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

function buildHeaders(request: FastifyRequest, drop: Set<string>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (drop.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function buildRequestUrl(request: FastifyRequest): string {
  const base = `${request.protocol}://${request.hostname}:${process.env.PORT ?? 3000}`;
  return new URL(request.url, base).toString();
}

export async function getSession(request: FastifyRequest): Promise<AuthSession> {
  const headers = buildHeaders(request, HOP_BY_HOP_REQUEST_HEADERS);
  return auth.api.getSession({ headers });
}

/**
 * Top-level preHandler that gates `/api/*` (except `/api/auth/*` and
 * `/api/health`) on a valid Better Auth session. Populates
 * `request.authSession` for downstream handlers.
 *
 * Registered directly on the app instance (not inside a plugin) so the hook
 * applies to ALL routes, including those registered later via plugins.
 * Fastify plugins encapsulate hooks added inside them — that encapsulation
 * is why this hook used to silently no-op when registered inside authPlugin.
 *
 * Must register BEFORE `request-context`, which reads `request.authSession`
 * to bind `userId` on the per-request child logger.
 */
export function registerAuthGuard(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0];

    if (
      !path.startsWith("/api/") ||
      path.startsWith("/api/auth/") ||
      path === "/api/health" ||
      path === "/api/config" ||
      // GET /api/play/:slug is public; the matching POST .../remix below
      // still requires auth. Auth handler is the wrong layer to make that
      // distinction (it doesn't know the method), so we exempt the whole
      // /api/play/* prefix and the remix route does its own session check.
      path.startsWith("/api/play/")
    ) {
      return;
    }

    try {
      const session = await getSession(request);
      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      // biome-ignore lint/suspicious/noExplicitAny: Better Auth session shape
      (request as FastifyRequest & { authSession: any }).authSession = session;
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });
}

export async function authPlugin(app: FastifyInstance) {
  // Capture form-encoded bodies as raw Buffers (Fastify only auto-parses
  // application/json out of the box). Better Auth needs to receive these
  // verbatim so it can parse them itself. JSON bodies are still parsed by
  // Fastify's default parser; we re-stringify them when forwarding.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "buffer" },
    (_request, payload, done) => {
      done(null, payload);
    }
  );

  // Delegate /api/auth/* to Better Auth. Enumerate methods explicitly
  // (omit OPTIONS) so @fastify/cors can install its own OPTIONS handler
  // for preflight. Using app.all(...) here would shadow CORS' OPTIONS
  // route and cause every cross-origin preflight to 404, which then
  // blocks /api/auth/sign-in/social and other POSTs from the web app.
  const authHandler = async (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply
  ) => {
    const url = buildRequestUrl(request);
    const headers = buildHeaders(request, HOP_BY_HOP_REQUEST_HEADERS);

    let body: ArrayBuffer | string | undefined;
    if (request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined) {
      // For form-encoded bodies, request.body is a Buffer (per the parser
      // above). For JSON bodies, request.body is the parsed object — we
      // re-stringify it so Better Auth sees valid JSON bytes again.
      if (Buffer.isBuffer(request.body)) {
        const buf = request.body;
        body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      } else {
        body = JSON.stringify(request.body);
      }
    }

    const webRequest = new Request(url, {
      method: request.method,
      headers,
      body,
    });

    const response = await auth.handler(webRequest);
    const responseBuffer = Buffer.from(await response.arrayBuffer());

    // Preserve any CORS / other headers that Fastify hooks (e.g. @fastify/cors
    // running in onRequest) already attached to the reply. After
    // reply.hijack() the onSend hooks are skipped, so anything we don't
    // forward to reply.raw here won't reach the client. Without this the
    // browser blocks the response with "No 'Access-Control-Allow-Origin'
    // header is present", even though the preflight succeeded.
    const preexistingHeaders = reply.getHeaders();

    // Bypass Fastify serialization. Write directly to the raw socket so the
    // already-encoded response body is sent unchanged.
    reply.hijack();
    reply.raw.statusCode = response.status;

    for (const [key, value] of Object.entries(preexistingHeaders)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_RESPONSE_HEADERS.has(lower)) continue;
      reply.raw.setHeader(
        key,
        Array.isArray(value) ? value.map(String) : (value as string | number)
      );
    }

    // Copy headers, but handle Set-Cookie specially. Headers.entries() collapses
    // multiple Set-Cookie values into a single comma-separated string, which
    // breaks browser parsing. Use getSetCookie() (Node 18+ / WHATWG fetch) to
    // recover them as separate values.
    const setCookies =
      typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
      "function"
        ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : [];

    for (const [key, value] of response.headers.entries()) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_RESPONSE_HEADERS.has(lower)) continue;
      if (lower === "set-cookie") continue;
      reply.raw.setHeader(key, value);
    }

    if (setCookies.length > 0) {
      // Node's setHeader accepts string[] for Set-Cookie and emits one line
      // per element.
      reply.raw.setHeader("set-cookie", setCookies);
    }

    reply.raw.end(responseBuffer);
  };

  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"] as const) {
    app.route({ method, url: "/api/auth/*", handler: authHandler });
  }
}
