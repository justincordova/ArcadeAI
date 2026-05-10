// Public discover gallery. Anyone — signed in or not — can browse public
// games, sorted by trending / top / new, optionally filtered by genre.
// Rendering is paginated; the frontend uses TanStack Query's
// `getNextPageParam` against the `nextOffset` returned here.
//
// This route is mounted on /api/discover, which means the auth guard does
// NOT exempt it by default — it only exempts /api/auth/*, /api/health,
// /api/config, and /api/play/*. We add /api/discover to the auth-exempt
// list at the guard registration site (plugins/auth.ts).

import { GENRE_BUCKETS } from "@arcadeai/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError, validationError } from "../lib/errors.js";
import { getSession } from "../plugins/auth.js";
import { listDiscoverGames } from "../services/discover/list.js";

const SORT_VALUES = ["trending", "top", "new"] as const;

const DiscoverQuery = z.object({
  sort: z.enum(SORT_VALUES).default("trending"),
  genre: z.enum(GENRE_BUCKETS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function discoverRoutes(app: FastifyInstance) {
  // GET /api/discover — paginated list of public games. The viewer's
  // session, if any, is used to hydrate `liked: boolean` per row so the
  // heart toggle reflects existing state on first paint.
  app.get("/api/discover", async (request, reply) => {
    const parsed = DiscoverQuery.safeParse(request.query);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        validationError("Invalid query", { issues: parsed.error.issues })
      );
    }

    const { sort, genre, limit, offset } = parsed.data;

    // Optional viewer — anonymous browsing is supported. A failed session
    // lookup falls through to anonymous; we don't want a stale cookie to
    // 401 a public page.
    let viewerUserId: string | null = null;
    try {
      const session = await getSession(request);
      if (session) viewerUserId = session.user.id;
    } catch {
      viewerUserId = null;
    }

    const items = await listDiscoverGames({
      sort,
      genre: genre ?? null,
      limit,
      offset,
      viewerUserId,
    });

    // Cursor pagination: if we got fewer than `limit` rows, we're at the
    // end and return null. Otherwise, advance by limit.
    const nextOffset = items.length < limit ? null : offset + limit;

    return reply.send({ items, nextOffset });
  });
}
