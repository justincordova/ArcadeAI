import Fastify from "fastify";
import { authPlugin, getSession } from "./plugins/auth.js";
import { corsPlugin } from "./plugins/cors.js";
import { billingRoutes } from "./routes/billing.js";
import { gamesRoutes } from "./routes/games.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";

const app = Fastify({
  logger:
    process.env.NODE_ENV !== "production"
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
            },
          },
          level: process.env.LOG_LEVEL ?? "info",
        }
      : {
          level: process.env.LOG_LEVEL ?? "info",
        },
});

// Plugins
await app.register(corsPlugin);
await app.register(authPlugin);

// Global auth guard on all /api/* except /api/auth/* and /api/health
app.addHook("preHandler", async (request, reply) => {
  const path = request.url.split("?")[0];

  if (!path.startsWith("/api/") || path.startsWith("/api/auth/") || path === "/api/health") {
    return;
  }

  try {
    const session = await getSession(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    // biome-ignore lint/suspicious/noExplicitAny: Better Auth session shape
    request.authSession = session as any;
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
});

// Routes
await app.register(healthRoutes);
await app.register(meRoutes);
await app.register(gamesRoutes);
await app.register(billingRoutes);

const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Server listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
