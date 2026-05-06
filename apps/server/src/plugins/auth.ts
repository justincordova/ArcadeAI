import type { FastifyInstance, FastifyRequest } from "fastify";
import { auth } from "../lib/auth.js";

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

export async function getSession(request: FastifyRequest): Promise<AuthSession> {
  const url = new URL(
    request.url,
    `${request.protocol}://${request.hostname}:${process.env.PORT ?? 3000}`
  );

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }
  }

  return auth.api.getSession({ headers });
}

export async function authPlugin(app: FastifyInstance) {
  // Delegate all /api/auth/* requests to Better Auth
  app.all("/api/auth/*", async (request, reply) => {
    const url = new URL(
      request.url,
      `${request.protocol}://${request.hostname}:${process.env.PORT ?? 3000}`
    );

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }
    }

    let body: BodyInit | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      body = JSON.stringify(request.body);
    }

    const webRequest = new Request(url.toString(), {
      method: request.method,
      headers,
      body,
    });

    const response = await auth.handler(webRequest);

    reply.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      reply.header(key, value);
    }

    const responseBody = await response.text();
    if (responseBody) {
      reply.send(responseBody);
    } else {
      reply.send();
    }
  });
}
