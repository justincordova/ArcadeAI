// Game routes entry point. The handlers are split across two modules:
//   - games/crud-routes.ts     — plain request/response CRUD, publish, undo
//   - games/streaming-routes.ts — the three Claude-backed SSE streams
// Both register onto the same Fastify instance; shared schemas and constants
// live in games/shared.ts.
import type { FastifyInstance } from "fastify";
import { registerGameCrudRoutes } from "./games/crud-routes.js";
import { registerGameStreamingRoutes } from "./games/streaming-routes.js";

export async function gamesRoutes(app: FastifyInstance) {
  registerGameCrudRoutes(app);
  registerGameStreamingRoutes(app);
}
