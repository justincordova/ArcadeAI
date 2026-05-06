import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

export async function corsPlugin(app: FastifyInstance) {
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });
}
