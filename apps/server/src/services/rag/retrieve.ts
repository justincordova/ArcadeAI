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

interface Logger {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}

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
 *
 * Logging: every successful retrieval emits a structured INFO line with
 * `{ ragExampleId, similarity, genreFilter, fellBackToGlobal }`. This is
 * the foundation every subsequent RAG decision depends on (multi-example
 * A/B testing, prompt-summarization quality assessment, editorial library
 * tuning) — the logs are the data source. Failures emit WARN.
 *
 * `bun:sqlite` calls are synchronous; the function is async only for
 * forward-compat with the route's awaited shape (and possible swap to
 * a remote vector store later).
 */
export async function retrieveExample({
  embedding,
  genre,
  log,
}: {
  embedding: number[] | null;
  genre: string;
  log?: Logger;
}): Promise<string | null> {
  if (!embedding) {
    log?.info(
      { genre, fellBackToGlobal: false, ragExampleId: null, reason: "no_embedding" },
      "rag retrieveExample skipped"
    );
    return null;
  }

  const useGenreFilter = GENRE_BUCKETS.has(genre) && genre !== "other";

  // `sqlite-vec` accepts embeddings as a Float32Array bound directly to
  // the query parameter (the package coerces it to the binary blob shape
  // it expects). See sqlite-vec JS docs.
  const vec = new Float32Array(embedding);

  try {
    // Pull id + raw cosine distance alongside the html so we can log how
    // close the chosen example was. distance ∈ [0, 2] for unit vectors;
    // similarity = 1 - distance is the more intuitive number to log.
    const sql = useGenreFilter
      ? `SELECT e.id AS id, e.html AS html, m.distance AS distance
           FROM rag_examples e
           JOIN (
             SELECT id, vec_distance_cosine(embedding, ?) AS distance
               FROM rag_embeddings
              WHERE genre = ?
              ORDER BY distance
              LIMIT 1
           ) m ON m.id = e.id`
      : `SELECT e.id AS id, e.html AS html, m.distance AS distance
           FROM rag_examples e
           JOIN (
             SELECT id, vec_distance_cosine(embedding, ?) AS distance
               FROM rag_embeddings
              ORDER BY distance
              LIMIT 1
           ) m ON m.id = e.id`;

    const stmt = sqlite.prepare(sql);
    const row = useGenreFilter ? stmt.get(vec, genre) : stmt.get(vec);
    if (!row) {
      log?.info(
        { genre, fellBackToGlobal: !useGenreFilter, ragExampleId: null, reason: "no_match" },
        "rag retrieveExample empty"
      );
      return null;
    }

    const r = row as { id: string; html: string; distance: number };
    const similarity = 1 - r.distance;
    log?.info(
      {
        ragExampleId: r.id,
        similarity,
        genreFilter: useGenreFilter ? genre : null,
        fellBackToGlobal: !useGenreFilter,
      },
      "rag retrieveExample hit"
    );
    return r.html;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err: msg, genre }, "rag retrieveExample failed");
    return null;
  }
}
