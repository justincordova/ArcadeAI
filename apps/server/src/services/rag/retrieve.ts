import { sqlite } from "../../lib/db.js";

/**
 * The 8 genre buckets from SPEC §6. `other` is the fallback bucket that
 * exercises the global-nearest-neighbor path (no inner `WHERE genre = ?`).
 */
const GENRE_BUCKETS = new Set([
  "paddle",
  "snake",
  "flappy",
  "shooter",
  "platformer",
  "puzzle",
  "runner",
  "other",
]);

/**
 * Retrieve the single nearest curated reference game (SPEC §8) for a
 * runtime prompt embedding, optionally filtered by classified genre.
 *
 * Returns the full HTML of the chosen reference, or `null` if:
 *  - the input embedding is null (upstream embedding call failed),
 *  - no rows are returned (curated library is empty), OR
 *  - the underlying vec0 query throws.
 *
 * Graceful degrade is by design: a `null` return lets the generation
 * pipeline fall back to the base contract without a few-shot example
 * (matches SPEC §6 "generation should never block on classification
 * failure").
 *
 * Genre handling:
 *  - `genre` is one of the 8 SPEC §6 buckets AND not `'other'` — the
 *    inner query filters on `WHERE genre = ?`.
 *  - `genre === 'other'` (or any value outside the 8 buckets) — the
 *    inner query is unfiltered (global nearest-neighbor fallback per
 *    SPEC §6 / §8).
 */
export async function retrieveExample({
  embedding,
  genre,
}: {
  embedding: number[] | null;
  genre: string;
}): Promise<string | null> {
  if (!embedding) return null;

  const useGenreFilter = GENRE_BUCKETS.has(genre) && genre !== "other";

  // `sqlite-vec` accepts embeddings as a Float32Array bound directly to
  // the query parameter (the package coerces it to the binary blob shape
  // it expects). See sqlite-vec JS docs.
  const vec = new Float32Array(embedding);

  try {
    // Single SQL query per SPEC §8 — filter and rank in one statement.
    const sql = useGenreFilter
      ? "SELECT html FROM rag_examples WHERE id IN (SELECT id FROM rag_embeddings WHERE genre = ? ORDER BY vec_distance_cosine(embedding, ?) LIMIT 1)"
      : "SELECT html FROM rag_examples WHERE id IN (SELECT id FROM rag_embeddings ORDER BY vec_distance_cosine(embedding, ?) LIMIT 1)";

    const stmt = sqlite.prepare(sql);
    const row = useGenreFilter ? stmt.get(genre, vec) : stmt.get(vec);
    if (!row) return null;
    return (row as { html: string }).html;
  } catch (err) {
    console.warn(
      `rag retrieveExample failed (genre=${genre}): ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
