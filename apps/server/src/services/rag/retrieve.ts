import { GENRE_BUCKETS } from "@arcadeai/shared/genres.js";
import { sql } from "../../lib/db.js";

/**
 * The genre buckets from SPEC §6, read from the shared package rather than
 * re-declared here. A local copy silently went stale: adding a bucket to
 * @arcadeai/shared updates the classifier, the discover filter, and the DB
 * enum, but a duplicate here would keep rejecting the new value and drop RAG
 * retrieval for it to the global-nearest path with no error.
 *
 * `other` is the fallback bucket that intentionally exercises that
 * global-nearest path (no inner `WHERE genre = ?`).
 */
const GENRE_BUCKET_SET: ReadonlySet<string> = new Set(GENRE_BUCKETS);

// Minimum cosine similarity (= 1 - distance) for a curated example to be
// considered relevant enough to inject as a few-shot reference. The library
// is small (~20 entries across 8 buckets), so the global-nearest match for an
// off-genre prompt can be a poor fit. Injecting an unrelated 2K-token example
// with the framing "build something in this style" actively misleads the
// model. Below this floor, return null and let the route fall back to the
// base contract alone. Tune from production `rag retrieveExample hit` logs.
const MIN_SIMILARITY = 0.4;

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
 *  - the underlying pgvector query throws.
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
 * pgvector's cosine-distance operator (`<=>`) returns distance in [0, 2].
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

  const useGenreFilter = GENRE_BUCKET_SET.has(genre) && genre !== "other";

  const vector = `[${embedding.join(",")}]`;

  try {
    const rows = useGenreFilter
      ? await sql<
          { id: string; html: string; distance: number }[]
        >`SELECT e.id, e.html, r.embedding <=> ${vector}::extensions.vector AS distance FROM rag_embeddings r JOIN rag_examples e ON e.id = r.id WHERE r.genre = ${genre} ORDER BY r.embedding <=> ${vector}::extensions.vector LIMIT 1`
      : await sql<
          { id: string; html: string; distance: number }[]
        >`SELECT e.id, e.html, r.embedding <=> ${vector}::extensions.vector AS distance FROM rag_embeddings r JOIN rag_examples e ON e.id = r.id ORDER BY r.embedding <=> ${vector}::extensions.vector LIMIT 1`;
    const row = rows[0];
    if (!row) {
      log?.info(
        { genre, fellBackToGlobal: !useGenreFilter, ragExampleId: null, reason: "no_match" },
        "rag retrieveExample empty"
      );
      return null;
    }

    const r = row;
    const similarity = 1 - r.distance;

    // Reject below the similarity floor so we don't inject an irrelevant
    // reference. The log still captures the rejected candidate so the
    // threshold can be tuned from real traffic.
    //
    // Non-finite distances must be rejected explicitly: SQLite can return NULL
    // for `distance` (making `1 - null` evaluate to 1, a perfect match), and a
    // zero-magnitude embedding yields NaN, for which `NaN < MIN_SIMILARITY` is
    // false. Either would sail past a bare `<` comparison and inject an
    // arbitrary 2K-token example under "build something in this style"
    // framing — exactly what this floor exists to prevent.
    if (!Number.isFinite(similarity) || similarity < MIN_SIMILARITY) {
      log?.info(
        {
          ragExampleId: r.id,
          similarity,
          genreFilter: useGenreFilter ? genre : null,
          fellBackToGlobal: !useGenreFilter,
          reason: "below_similarity_floor",
          floor: MIN_SIMILARITY,
        },
        "rag retrieveExample rejected"
      );
      return null;
    }

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
