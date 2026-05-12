// OG image route — serves a 1200x630-ish PNG for use as og:image /
// twitter:image when sharing /play/:slug links. The thumbnail captured
// after generation is already a 16:9 canvas dataURL; we decode it and
// serve as image/png. If a game has no thumbnail (older publishes,
// captures that failed), we serve a fallback PNG generated once at
// process start from a static base64 string.
//
// Mounted at /api/og/:slug.png — the .png suffix is purely cosmetic
// for crawlers that prefer file-extension URLs.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notFoundError, sendError, validationError } from "../lib/errors.js";
import { loadPublicGame } from "../lib/ownership.js";

const SlugParams = z.object({
  // Match the slug pattern; ".png" suffix is consumed by the route path,
  // so the param itself is the bare slug.
  slug: z.string().min(1).max(64),
});

// 16:9 placeholder PNG — small dark gradient. Generated as a tiny
// hard-coded PNG so we don't need any image library at runtime. If a
// game has no captured thumbnail we serve this; better than a 404 in
// social unfurls.
const FALLBACK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAACQCAIAAACoIaSWAAAACXBIWXMAAA7EAAAOxAGVKw4bAAABF0lEQVR4nO3RMQEAAAjDsOHf9F4oIJUgLZ3uzEqAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBo2gN2nQEByYR9vAAAAABJRU5ErkJggg==";

const FALLBACK_PNG = Buffer.from(FALLBACK_PNG_BASE64, "base64");

// Long cache — thumbnails change rarely once a game is published. If a
// game is republished after a thumbnail change, the slug stays the same
// but the cache will lag for a few minutes. That's an acceptable
// tradeoff for unfurl performance.
const CACHE_HEADER = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";

export async function ogRoutes(app: FastifyInstance) {
  app.get("/api/og/:slug.png", async (request, reply) => {
    const parsed = SlugParams.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, 400, validationError("Invalid slug"));
    }

    const game = await loadPublicGame(parsed.data.slug);
    if (!game) {
      // Send the fallback rather than 404 so a crawler that hits this
      // before publish-time still gets an unfurl. This is a tradeoff:
      // a totally bogus slug also returns a placeholder. The slug is
      // 8-hex random, so brute-force enumeration is impractical.
      reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=60")
        .send(FALLBACK_PNG);
      return;
    }

    if (!game.thumbnail) {
      reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", CACHE_HEADER)
        .send(FALLBACK_PNG);
      return;
    }

    // Thumbnail is stored as a data: URL. Strip the prefix and decode.
    // Defensive: if the prefix doesn't match what the wrapper writes,
    // fall back to the placeholder rather than serving garbage bytes.
    const match = game.thumbnail.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!match) {
      reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", CACHE_HEADER)
        .send(FALLBACK_PNG);
      return;
    }

    const mime = `image/${match[1]}`;
    const buf = Buffer.from(match[2] ?? "", "base64");

    // Buffer.from silently drops invalid base64 characters — it never throws.
    // A truncated or tampered thumbnail decodes to a short bag of bytes that
    // we'd otherwise serve as `image/png`, then social-media crawlers cache
    // the broken unfurl for an hour. Verify the magic bytes match the
    // declared MIME and fall back to the placeholder when they don't.
    if (!hasExpectedMagic(buf, match[1])) {
      reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", CACHE_HEADER)
        .send(FALLBACK_PNG);
      return;
    }

    reply.header("Content-Type", mime).header("Cache-Control", CACHE_HEADER).send(buf);
  });
}

// Cheap magic-byte sniff for the three image types we accept. Returns
// false if the buffer is too short or the leading bytes don't match.
function hasExpectedMagic(buf: Buffer, kind: string | undefined): boolean {
  if (buf.length < 12) return false;
  if (kind === "png") {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (kind === "jpeg") {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (kind === "webp") {
    return (
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    );
  }
  return false;
}
