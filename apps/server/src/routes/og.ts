// OG image route — serves a 1200x630-ish PNG for use as og:image /
// twitter:image when sharing /play/:slug links. The thumbnail captured
// after generation is already a 16:9 canvas dataURL; we decode it and
// serve as image/png. If a game has no thumbnail (older publishes,
// captures that failed), we serve a fallback PNG.
//
// Mounted at /api/og/:slug.png — the .png suffix is purely cosmetic
// for crawlers that prefer file-extension URLs.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError, validationError } from "../lib/errors.js";
import { loadPublicGame } from "../lib/ownership.js";
import { FALLBACK_PNG, PLACEHOLDER_CACHE_HEADER, serveThumbnail } from "../lib/serve-thumbnail.js";

// Slugs are 8 lowercase hex chars (see routes/games.ts publish handler).
// The ".png" suffix is consumed by the route path so the param is the
// bare slug. Tightening the regex avoids burning a DB lookup on garbage.
const SlugParams = z.object({
  slug: z.string().regex(/^[0-9a-f]{8}$/i, "Invalid slug format"),
});

export async function ogRoutes(app: FastifyInstance) {
  app.get("/api/og/:slug.png", async (request, reply) => {
    const parsed = SlugParams.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, 400, validationError("Invalid slug"));
    }

    // A DB error here (outage, disk) would otherwise escape to Fastify's
    // global error handler and return a JSON 500 with an application/json
    // content-type to a crawler expecting an image. Serve the placeholder
    // PNG instead, mirroring the not-found branch — the sibling public
    // routes (play.ts, discover.ts) apply the same try/catch treatment.
    let game: Awaited<ReturnType<typeof loadPublicGame>>;
    try {
      game = await loadPublicGame(parsed.data.slug);
    } catch (err) {
      request.log.warn({ err }, "loadPublicGame threw serving OG image; serving fallback");
      game = null;
    }

    if (!game) {
      // Send the fallback rather than 404 so a crawler that hits this
      // before publish-time still gets an unfurl. This is a tradeoff:
      // a totally bogus slug also returns a placeholder. The slug is
      // 8-hex random, so brute-force enumeration is impractical.
      reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", PLACEHOLDER_CACHE_HEADER)
        .send(FALLBACK_PNG);
      return;
    }

    serveThumbnail(reply, game.thumbnail);
  });
}
