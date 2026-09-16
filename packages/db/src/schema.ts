import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const TIER_VALUES = ["free", "creator", "pro", "admin"] as const;
const GENRE_VALUES = [
  "paddle",
  "snake",
  "flappy",
  "shooter",
  "platformer",
  "puzzle",
  "runner",
  "other",
] as const;
const MESSAGE_KIND_VALUES = ["prompt", "feedback", "summary"] as const;
const USAGE_ACTION_VALUES = ["generation", "refinement", "repair"] as const;
const THEME_VALUES = ["dark", "light", "system"] as const;
const ms = (name: string) => bigint(name, { mode: "number" });

// Profiles are created lazily from a verified Supabase Auth JWT.
export const users = pgTable("user", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull().default(""),
  image: text("image"),
  displayName: text("display_name").notNull().default(""),
  tier: text("tier", { enum: TIER_VALUES }).notNull().default("free"),
  creditsRemainingDaily: integer("credits_remaining_daily").notNull().default(500),
  creditsRemainingMonthly: integer("credits_remaining_monthly").notNull().default(3000),
  dailyResetAt: ms("daily_reset_at").notNull().default(0),
  monthlyResetAt: ms("monthly_reset_at").notNull().default(0),
  lifetimeGenerationsUsed: integer("lifetime_generations_used").notNull().default(0),
  lifetimeRefinementsUsed: integer("lifetime_refinements_used").notNull().default(0),
  theme: text("theme", { enum: THEME_VALUES }).notNull().default("dark"),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

export const games = pgTable(
  "games",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    currentCode: text("current_code").notNull().default(""),
    previousCode: text("previous_code"),
    thumbnail: text("thumbnail"),
    genre: text("genre", { enum: GENRE_VALUES }),
    originalPrompt: text("original_prompt").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    publicSlug: text("public_slug").unique(),
    publishedAt: ms("published_at"),
    remixedFromGameId: text("remixed_from_game_id"),
    playCount: integer("play_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    index("idx_games_user_id").on(t.userId),
    index("idx_games_public_published").on(t.isPublic, t.publishedAt),
    index("idx_games_genre_public_published").on(t.genre, t.isPublic, t.publishedAt),
    index("idx_games_public_likecount").on(t.isPublic, t.likeCount),
  ]
);

export const gameLikes = pgTable(
  "game_likes",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_game_likes_unique").on(t.gameId, t.userId),
    index("idx_game_likes_user").on(t.userId),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MESSAGE_KIND_VALUES }).notNull(),
    content: text("content").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("idx_messages_game_id").on(t.gameId)]
);

export const usageLog = pgTable(
  "usage_log",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: text("game_id").references(() => games.id, { onDelete: "set null" }),
    action: text("action", { enum: USAGE_ACTION_VALUES }).notNull(),
    creditsCharged: integer("credits_charged").notNull(),
    lifetimeCounterIncremented: boolean("lifetime_counter_incremented").notNull().default(false),
    succeeded: integer("succeeded").notNull().default(0),
    refundedAt: ms("refunded_at"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    index("idx_usage_log_user_id_created_at").on(t.userId, t.createdAt),
    index("idx_usage_log_game_id").on(t.gameId),
  ]
);

export const ragExamples = pgTable("rag_examples", {
  id: text("id").primaryKey(),
  genre: text("genre", { enum: GENRE_VALUES }).notNull(),
  prompt: text("prompt").notNull(),
  html: text("html").notNull(),
  createdAt: ms("created_at").notNull(),
});
