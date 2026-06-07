// Shared helper for serving a game thumbnail stored as a data: URL.
// Used by the public OG route (by slug) and the owner-scoped dashboard
// thumbnail route (by id). Decodes the data URL, validates the magic bytes,
// and writes the image bytes — falling back to a placeholder PNG when the
// thumbnail is absent or malformed.

import type { FastifyReply } from "fastify";

// 16:9 placeholder PNG — small dark gradient. Hard-coded so we need no image
// library at runtime. Served when a game has no captured thumbnail yet.
const FALLBACK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAACQCAIAAACoIaSWAAAACXBIWXMAAA7EAAAOxAGVKw4bAAABF0lEQVR4nO3RMQEAAAjDsOHf9F4oIJUgLZ3uzEqAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBoWkCgaQGBpgUEmhYQaFpAoGkBgaYFBJoWEGhaQKBpAYGmBQSaFhBo2gN2nQEByYR9vAAAAABJRU5ErkJggg==";

export const FALLBACK_PNG = Buffer.from(FALLBACK_PNG_BASE64, "base64");

// Long cache — thumbnails change rarely once captured.
export const THUMBNAIL_CACHE_HEADER =
  "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";

// Short cache for transient placeholder responses (thumbnail not captured yet,
// or a malformed/truncated capture that may be re-captured). Caching the
// placeholder long would shadow the real thumbnail once it lands.
export const PLACEHOLDER_CACHE_HEADER = "public, max-age=60";

/**
 * Write a game thumbnail (data: URL) to the reply as image bytes, or a
 * short-cached placeholder PNG when it's absent/malformed. Used by both the
 * OG route and the owner dashboard thumbnail route.
 */
export function serveThumbnail(reply: FastifyReply, thumbnail: string | null): void {
  if (!thumbnail) {
    reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", PLACEHOLDER_CACHE_HEADER)
      .send(FALLBACK_PNG);
    return;
  }

  const match = thumbnail.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!match) {
    reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", PLACEHOLDER_CACHE_HEADER)
      .send(FALLBACK_PNG);
    return;
  }

  const mime = `image/${match[1]}`;
  const buf = Buffer.from(match[2] ?? "", "base64");

  // Buffer.from silently drops invalid base64 — verify the magic bytes match
  // the declared MIME so we never serve garbage bytes as a valid image.
  if (!hasExpectedMagic(buf, match[1])) {
    reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", PLACEHOLDER_CACHE_HEADER)
      .send(FALLBACK_PNG);
    return;
  }

  reply.header("Content-Type", mime).header("Cache-Control", THUMBNAIL_CACHE_HEADER).send(buf);
}

// Cheap magic-byte sniff for the three image types we accept. Returns false if
// the buffer is too short or the leading bytes don't match.
export function hasExpectedMagic(buf: Buffer, kind: string | undefined): boolean {
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
