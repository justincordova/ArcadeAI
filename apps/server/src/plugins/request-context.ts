import type { FastifyInstance, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    startTime: number;
  }
}

/**
 * Attaches per-request structured logging context per SPEC §14:
 * - requestId and userId are bound as child logger fields.
 * - Emits a single INFO line per completed request: route, method, status, duration_ms.
 */
export async function registerRequestContext(app: FastifyInstance) {
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
    request.log.info(
      {
        route: request.routeOptions?.url ?? request.url,
        method: request.method,
        status: reply.statusCode,
        duration_ms: Date.now() - request.startTime,
      },
      "request completed"
    );
  });
}
