import { Database } from "bun:sqlite";
import { loadSqliteVec, selectCustomSqliteIfNeeded } from "./sqlite-vec-loader.js";

/**
 * The `rag_embeddings` vec0 virtual table cannot be expressed in Drizzle's
 * schema DSL, so it's created here as raw SQL after the standard Drizzle
 * migrations. The `genre` column is a vec0 metadata column duplicated from
 * `rag_examples.genre` per SPEC §5 so the SPEC §8 retrieval query can filter
 * and rank in a single statement without a join.
 */
export function runPostMigrate(dbPath: string) {
  selectCustomSqliteIfNeeded();
  const sqlite = new Database(dbPath);
  // Wrap in try/finally so a failure during loadSqliteVec or the CREATE
  // statement still closes the DB handle. Otherwise the WAL/SHM files
  // are left attached to a process-wide handle that never goes away.
  try {
    loadSqliteVec(sqlite);

    sqlite.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS rag_embeddings USING vec0(id text primary key, genre text, embedding float[1536])"
    );

    console.log("[post-migrate] rag_embeddings vec0 virtual table ready");
  } finally {
    sqlite.close();
  }
}
