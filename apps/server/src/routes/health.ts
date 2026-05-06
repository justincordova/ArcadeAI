import type { FastifyInstance } from "fastify";

const version = "0.0.1";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async (_request, reply) => {
    return reply.send({ ok: true, version });
  });
}
