import type { FastifyInstance, FastifyRequest } from "fastify";
import { auth } from "../lib/auth.js";

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

// Headers that must not be forwarded from the original Fastify request to the
// reconstructed Web Request, because their values would be wrong after we
// re-encode the body (or are hop-by-hop / connection-scoped).
const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "content-length",
  "host",
  "connection",
  "transfer-encoding",
]);

// Response headers we must strip before forwarding to Fastify, because we've
// already decoded the body via response.text() and Fastify will recompute these.
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

export async function authPlugin(app: FastifyInstance) {
  // Delegate all /api/auth/* requests to Better Auth
  app.all("/api/auth/*", async (request, reply) => {
    const url = buildRequestUrl(request);
    const headers = buildHeaders(request, HOP_BY_HOP_REQUEST_HEADERS);

    let body: BodyInit | undefined;
    if (request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined) {
      body = JSON.stringify(request.body);
    }

    const webRequest = new Request(url, {
      method: request.method,
      headers,
      body,
    });

    const response = await auth.handler(webRequest);

    // Write directly to the raw socket so Fastify does not re-serialize the
    // (already-JSON) response body and double-encode it.
    const responseBuffer = Buffer.from(await response.arrayBuffer());
    reply.hijack();
    reply.raw.statusCode = response.status;
    for (const [key, value] of response.headers.entries()) {
      if (HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
      reply.raw.setHeader(key, value);
    }
    reply.raw.end(responseBuffer);
  });
}
