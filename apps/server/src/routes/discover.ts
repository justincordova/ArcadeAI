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

// Deepest page the API will serve. Shared by the query validator and the
// nextOffset computation so the two can't disagree.
const MAX_OFFSET = 10_000;

const DiscoverQuery = z.object({
  sort: z.enum(SORT_VALUES).default("trending"),
  genre: z.enum(GENRE_BUCKETS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  // Bound the offset as well as the limit. This route is unauthenticated, and
  // the `trending` ORDER BY is a computed expression no index can serve, so a
  // large offset forces SQLite to rank and discard that many rows per request.
  offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
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
    } catch (err) {
      // Anonymous fallback is the right UX, but a thrown lookup means
      // something is broken (DB / auth-service). Without a log line every
      // authed viewer silently appears anonymous on /discover — and ops
      // would see no signal.
      request.log.warn({ err }, "getSession threw on discover; serving anonymous view");
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
    // Never advertise an offset the query schema would reject — the client
    // feeds this straight back as `offset`, so exceeding the cap would turn
    // the end of the list into a 400 instead of a clean termination.
    const next = offset + limit;
    const nextOffset = items.length < limit || next > MAX_OFFSET ? null : next;

    return reply.send({ items, nextOffset });
  });
}
