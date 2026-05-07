import type { FastifyInstance } from "fastify";

const version = "0.0.1";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async (_request, reply) => {
    return reply.send({ ok: true, version });
  });

  // Config probe — tells the client which AI provider keys are present.
  // Returns 200 regardless; the client interprets the booleans.
  // This route is intentionally unauthenticated so the builder can check
  // before showing the prompt input.
  app.get("/api/config", async (_request, reply) => {
    return reply.send({
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    });
  });
}
