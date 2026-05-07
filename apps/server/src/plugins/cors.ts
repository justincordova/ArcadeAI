import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

/**
 * Registers @fastify/cors directly on the passed app instance.
 *
 * @fastify/cors is fastify-plugin-wrapped (de-encapsulated), so its hooks
 * apply globally as long as we register it on the root app. If we wrapped
 * this in our own plain async function and used `app.register(corsPlugin)`,
 * the encapsulation would scope the cors hooks to that plugin and they
 * would never fire on top-level routes — leading to missing CORS headers
 * on non-preflight responses (preflight works because cors registers a
 * route, not a hook, for OPTIONS).
 */
export async function registerCors(app: FastifyInstance) {
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });
}
