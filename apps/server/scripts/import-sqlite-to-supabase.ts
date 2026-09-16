/**
 * Imports legacy application data. Better Auth accounts, sessions, and
 * verifications are intentionally excluded because Supabase Auth owns them.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { createClient } from "@arcadeai/db";
import {
  loadSqliteVec,
  selectCustomSqliteIfNeeded,
} from "../../../packages/db/src/sqlite-vec-loader.ts";

type User = {
  id: string;
  email: string;
  email_verified: number;
  name: string;
  image: string | null;
  display_name: string;
  tier: string;
  credits_remaining_daily: number;
  credits_remaining_monthly: number;
  daily_reset_at: number;
  monthly_reset_at: number;
  lifetime_generations_used: number;
  lifetime_refinements_used: number;
  theme: string;
  created_at: number;
  updated_at: number;
};
type Game = {
  id: string;
  user_id: string;
  title: string;
  current_code: string;
  previous_code: string | null;
  thumbnail: string | null;
  genre: string | null;
  original_prompt: string;
  is_public: number;
  public_slug: string | null;
  published_at: number | null;
  remixed_from_game_id: string | null;
  play_count: number;
  like_count: number;
  created_at: number;
  updated_at: number;
};
type Message = { id: string; game_id: string; kind: string; content: string; created_at: number };
type Like = { game_id: string; user_id: string; created_at: number };
type Usage = {
  id: string;
  user_id: string;
  game_id: string | null;
  action: string;
  credits_charged: number;
  lifetime_counter_incremented: number;
  succeeded: number;
  refunded_at: number | null;
  created_at: number;
};
type RagExample = { id: string; genre: string; prompt: string; html: string; created_at: number };
type RagEmbedding = { id: string; genre: string; embedding: Uint8Array };
type SupabaseUser = { id: string; email?: string };

const sourcePath = process.env.SOURCE_DATABASE_PATH;
const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readRows<T>(db: Database, query: string): T[] {
  return db.prepare(query).all() as T[];
}

function vectorLiteral(blob: Uint8Array): string {
  if (blob.byteLength !== 1536 * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`sqlite-vec embedding has ${blob.byteLength} bytes; expected 6144`);
  }
  const values = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("sqlite-vec embedding contains a non-finite value");
  }
  return `[${values.join(",")}]`;
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = requireEnv("SUPABASE_URL", supabaseUrl);
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);
  const response = await fetch(`${url}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Supabase Admin API ${init?.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`
    );
  }
  return (await response.json()) as T;
}

async function getAuthUsersByEmail(): Promise<Map<string, string>> {
  const users = new Map<string, string>();
  for (let page = 1; ; page += 1) {
    const result = await adminRequest<{ users: SupabaseUser[] }>(
      `/users?page=${page}&per_page=1000`
    );
    for (const user of result.users) {
      if (user.email) users.set(user.email.toLowerCase(), user.id);
    }
    if (result.users.length < 1000) return users;
  }
}

async function main() {
  const sqlitePath = requireEnv("SOURCE_DATABASE_PATH", sourcePath);
  requireEnv("DATABASE_URL", databaseUrl);
  requireEnv("SUPABASE_URL", supabaseUrl);
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);
  if (!existsSync(sqlitePath))
    throw new Error(`SOURCE_DATABASE_PATH does not exist: ${sqlitePath}`);

  // vec0 must be loaded before querying the legacy virtual embedding table.
  selectCustomSqliteIfNeeded();
  const source = new Database(sqlitePath, { readonly: true });
  try {
    loadSqliteVec(source);
    const users = readRows<User>(source, "SELECT * FROM user ORDER BY created_at, id");
    const games = readRows<Game>(source, "SELECT * FROM games ORDER BY created_at, id");
    const messages = readRows<Message>(source, "SELECT * FROM messages ORDER BY created_at, id");
    const likes = readRows<Like>(source, "SELECT * FROM game_likes ORDER BY created_at");
    const usage = readRows<Usage>(source, "SELECT * FROM usage_log ORDER BY created_at, id");
    const ragExamples = readRows<RagExample>(source, "SELECT * FROM rag_examples ORDER BY id");
    const ragEmbeddings = readRows<RagEmbedding>(
      source,
      "SELECT * FROM rag_embeddings ORDER BY id"
    );

    const sourceUserIds = new Set(users.map((user) => user.id));
    const gameIds = new Set(games.map((game) => game.id));
    const sourceEmails = new Set<string>();
    for (const user of users) {
      const email = user.email.toLowerCase();
      if (sourceEmails.has(email)) {
        throw new Error(`multiple source users normalize to the same email: ${user.email}`);
      }
      sourceEmails.add(email);
    }
    for (const game of games) {
      if (!sourceUserIds.has(game.user_id))
        throw new Error(`game ${game.id} references missing user ${game.user_id}`);
    }
    for (const message of messages) {
      if (!gameIds.has(message.game_id))
        throw new Error(`message ${message.id} references missing game ${message.game_id}`);
    }
    for (const like of likes) {
      if (!gameIds.has(like.game_id) || !sourceUserIds.has(like.user_id)) {
        throw new Error(`like ${like.game_id}/${like.user_id} has a missing reference`);
      }
    }
    for (const entry of usage) {
      if (!sourceUserIds.has(entry.user_id) || (entry.game_id && !gameIds.has(entry.game_id))) {
        throw new Error(`usage row ${entry.id} has a missing reference`);
      }
    }

    const authIdsByEmail = await getAuthUsersByEmail();
    const userIds = new Map<string, string>();
    let createdAuthUsers = 0;
    for (const user of users) {
      const email = user.email.toLowerCase();
      let authId = authIdsByEmail.get(email);
      if (!authId) {
        const created = await adminRequest<SupabaseUser>("/users", {
          method: "POST",
          body: JSON.stringify({ email: user.email, email_confirm: user.email_verified !== 0 }),
        });
        authId = created.id;
        authIdsByEmail.set(email, authId);
        createdAuthUsers += 1;
      }
      userIds.set(user.id, authId);
    }

    const { sql } = createClient(databaseUrl as string);
    try {
      await sql.begin(async (tx) => {
        for (const user of users) {
          await tx`INSERT INTO "user" (id, email, email_verified, name, image, display_name, tier, credits_remaining_daily, credits_remaining_monthly, daily_reset_at, monthly_reset_at, lifetime_generations_used, lifetime_refinements_used, theme, created_at, updated_at) VALUES (${userIds.get(user.id) as string}::uuid, ${user.email}, ${user.email_verified !== 0}, ${user.name}, ${user.image}, ${user.display_name}, ${user.tier}, ${user.credits_remaining_daily}, ${user.credits_remaining_monthly}, ${user.daily_reset_at}, ${user.monthly_reset_at}, ${user.lifetime_generations_used}, ${user.lifetime_refinements_used}, ${user.theme}, ${user.created_at}, ${user.updated_at}) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, email_verified = EXCLUDED.email_verified, name = EXCLUDED.name, image = EXCLUDED.image, display_name = EXCLUDED.display_name, tier = EXCLUDED.tier, credits_remaining_daily = EXCLUDED.credits_remaining_daily, credits_remaining_monthly = EXCLUDED.credits_remaining_monthly, daily_reset_at = EXCLUDED.daily_reset_at, monthly_reset_at = EXCLUDED.monthly_reset_at, lifetime_generations_used = EXCLUDED.lifetime_generations_used, lifetime_refinements_used = EXCLUDED.lifetime_refinements_used, theme = EXCLUDED.theme, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`;
        }
        for (const game of games) {
          await tx`INSERT INTO games (id, user_id, title, current_code, previous_code, thumbnail, genre, original_prompt, is_public, public_slug, published_at, remixed_from_game_id, play_count, like_count, created_at, updated_at) VALUES (${game.id}, ${userIds.get(game.user_id) as string}::uuid, ${game.title}, ${game.current_code}, ${game.previous_code}, ${game.thumbnail}, ${game.genre}, ${game.original_prompt}, ${game.is_public !== 0}, ${game.public_slug}, ${game.published_at}, ${game.remixed_from_game_id}, ${game.play_count}, ${game.like_count}, ${game.created_at}, ${game.updated_at}) ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, title = EXCLUDED.title, current_code = EXCLUDED.current_code, previous_code = EXCLUDED.previous_code, thumbnail = EXCLUDED.thumbnail, genre = EXCLUDED.genre, original_prompt = EXCLUDED.original_prompt, is_public = EXCLUDED.is_public, public_slug = EXCLUDED.public_slug, published_at = EXCLUDED.published_at, remixed_from_game_id = EXCLUDED.remixed_from_game_id, play_count = EXCLUDED.play_count, like_count = EXCLUDED.like_count, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`;
        }
        for (const message of messages) {
          await tx`INSERT INTO messages (id, game_id, kind, content, created_at) VALUES (${message.id}, ${message.game_id}, ${message.kind}, ${message.content}, ${message.created_at}) ON CONFLICT (id) DO UPDATE SET game_id = EXCLUDED.game_id, kind = EXCLUDED.kind, content = EXCLUDED.content, created_at = EXCLUDED.created_at`;
        }
        for (const like of likes) {
          await tx`INSERT INTO game_likes (game_id, user_id, created_at) VALUES (${like.game_id}, ${userIds.get(like.user_id) as string}::uuid, ${like.created_at}) ON CONFLICT (game_id, user_id) DO UPDATE SET created_at = EXCLUDED.created_at`;
        }
        for (const entry of usage) {
          await tx`INSERT INTO usage_log (id, user_id, game_id, action, credits_charged, lifetime_counter_incremented, succeeded, refunded_at, created_at) VALUES (${entry.id}, ${userIds.get(entry.user_id) as string}::uuid, ${entry.game_id}, ${entry.action}, ${entry.credits_charged}, ${entry.lifetime_counter_incremented !== 0}, ${entry.succeeded}, ${entry.refunded_at}, ${entry.created_at}) ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, game_id = EXCLUDED.game_id, action = EXCLUDED.action, credits_charged = EXCLUDED.credits_charged, lifetime_counter_incremented = EXCLUDED.lifetime_counter_incremented, succeeded = EXCLUDED.succeeded, refunded_at = EXCLUDED.refunded_at, created_at = EXCLUDED.created_at`;
        }
        for (const example of ragExamples) {
          await tx`INSERT INTO rag_examples (id, genre, prompt, html, created_at) VALUES (${example.id}, ${example.genre}, ${example.prompt}, ${example.html}, ${example.created_at}) ON CONFLICT (id) DO UPDATE SET genre = EXCLUDED.genre, prompt = EXCLUDED.prompt, html = EXCLUDED.html, created_at = EXCLUDED.created_at`;
        }
        for (const embedding of ragEmbeddings) {
          const vector = vectorLiteral(embedding.embedding);
          await tx`INSERT INTO rag_embeddings (id, genre, embedding) VALUES (${embedding.id}, ${embedding.genre}, ${vector}::extensions.vector) ON CONFLICT (id) DO UPDATE SET genre = EXCLUDED.genre, embedding = EXCLUDED.embedding`;
        }
      });
    } finally {
      await sql.end();
    }
    console.log(
      `Imported ${users.length} users (${createdAuthUsers} Supabase Auth users created), ${games.length} games, ${messages.length} messages, ${likes.length} likes, ${usage.length} usage rows, ${ragExamples.length} RAG examples, and ${ragEmbeddings.length} RAG embeddings.`
    );
  } finally {
    source.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
