CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE "user" (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  name text NOT NULL DEFAULT '',
  image text,
  display_name text NOT NULL DEFAULT '',
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'creator', 'pro', 'admin')),
  credits_remaining_daily integer NOT NULL DEFAULT 500,
  credits_remaining_monthly integer NOT NULL DEFAULT 3000,
  daily_reset_at bigint NOT NULL DEFAULT 0,
  monthly_reset_at bigint NOT NULL DEFAULT 0,
  lifetime_generations_used integer NOT NULL DEFAULT 0,
  lifetime_refinements_used integer NOT NULL DEFAULT 0,
  theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE games (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title text NOT NULL,
  current_code text NOT NULL DEFAULT '',
  previous_code text,
  thumbnail text,
  genre text CHECK (genre IN ('paddle', 'snake', 'flappy', 'shooter', 'platformer', 'puzzle', 'runner', 'other')),
  original_prompt text NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  public_slug text UNIQUE,
  published_at bigint,
  remixed_from_game_id text,
  play_count integer NOT NULL DEFAULT 0,
  like_count integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX idx_games_user_id ON games(user_id);
CREATE INDEX idx_games_public_published ON games(is_public, published_at);
CREATE INDEX idx_games_genre_public_published ON games(genre, is_public, published_at);
CREATE INDEX idx_games_public_likecount ON games(is_public, like_count);

CREATE TABLE game_likes (
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at bigint NOT NULL,
  UNIQUE(game_id, user_id)
);

CREATE INDEX idx_game_likes_user ON game_likes(user_id);

CREATE TABLE messages (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('prompt', 'feedback', 'summary')),
  content text NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX idx_messages_game_id ON messages(game_id);

CREATE TABLE usage_log (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  game_id text REFERENCES games(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('generation', 'refinement', 'repair')),
  credits_charged integer NOT NULL,
  lifetime_counter_incremented boolean NOT NULL DEFAULT false,
  succeeded integer NOT NULL DEFAULT 0,
  refunded_at bigint,
  created_at bigint NOT NULL
);

CREATE INDEX idx_usage_log_user_id_created_at ON usage_log(user_id, created_at);
CREATE INDEX idx_usage_log_game_id ON usage_log(game_id);

CREATE TABLE rag_examples (
  id text PRIMARY KEY,
  genre text NOT NULL CHECK (genre IN ('paddle', 'snake', 'flappy', 'shooter', 'platformer', 'puzzle', 'runner', 'other')),
  prompt text NOT NULL,
  html text NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE rag_embeddings (
  id text PRIMARY KEY REFERENCES rag_examples(id) ON DELETE CASCADE,
  genre text NOT NULL,
  embedding extensions.vector(1536) NOT NULL
);
