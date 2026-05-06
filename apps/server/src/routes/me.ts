import type { FastifyInstance } from "fastify";

export async function meRoutes(app: FastifyInstance) {
  app.get("/api/me", async (request, reply) => {
    const { user } = request.authSession;
    const u = user as Record<string, unknown>;
    return reply.send({
      id: user.id,
      email: user.email,
      displayName: u.displayName ?? user.name ?? "",
      tier: u.tier ?? "free",
    });
  });
}
