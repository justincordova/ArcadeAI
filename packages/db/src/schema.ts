import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Closed enum sets used by typed `text(..., { enum })` columns. Duplicated
// from `@arcadeai/shared` rather than imported because @arcadeai/db is a
// lower-level package — letting it depend back on shared would create a
// circular relationship in the workspace graph.
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

// users — extended from Better Auth's user table
// Better Auth manages the base user/session/account/verification tables.
// Our custom columns are declared here and included via Better Auth's additionalFields.
export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  name: text("name").notNull().default(""),
  image: text("image"),
  displayName: text("display_name").notNull().default(""),
  tier: text("tier", { enum: TIER_VALUES }).notNull().default("free"),
  creditsRemainingDaily: integer("credits_remaining_daily").notNull().default(500),
  creditsRemainingMonthly: integer("credits_remaining_monthly").notNull().default(3000),
  dailyResetAt: integer("daily_reset_at").notNull().default(0),
  monthlyResetAt: integer("monthly_reset_at").notNull().default(0),
  // Lifetime counters used by the temporary deployment-phase free-tier policy
  // (see packages/shared/src/plans.ts:FREE_TIER_LIFETIME_LIMITS). These are
  // monotonically incremented on success and decremented only on refund. They
  // exist for all tiers so the schema is consistent, but are only enforced
  // when ENFORCE_LIFETIME_LIMITS_FOR_FREE is true and tier === 'free'.
  lifetimeGenerationsUsed: integer("lifetime_generations_used").notNull().default(0),
  lifetimeRefinementsUsed: integer("lifetime_refinements_used").notNull().default(0),
  theme: text("theme", { enum: THEME_VALUES }).notNull().default("dark"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const sessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  // SQLite does not auto-index FK columns. Without this, every Better
  // Auth session lookup (one per authed request) plus the ON DELETE
  // CASCADE from user deletion both fall back to a full scan.
  (table) => [index("idx_session_user_id").on(table.userId)]
);

export const accounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  // Read on every /api/me and /api/billing/change-plan, plus the
  // /api/me delete cascade. Unindexed would be a full table scan per
  // authed request.
  (table) => [index("idx_account_user_id").on(table.userId)]
);

export const verifications = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const games = sqliteTable(
  "games",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    currentCode: text("current_code").notNull().default(""),
    thumbnail: text("thumbnail"),
    genre: text("genre", { enum: GENRE_VALUES }),
    originalPrompt: text("original_prompt").notNull(),
    // Public sharing — when isPublic is true, the game is reachable via
    // /play/<publicSlug> with no auth required. Slug is generated on first
    // publish and retained on unpublish so re-publishing keeps the same URL.
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
    publicSlug: text("public_slug").unique(),
    publishedAt: integer("published_at"),
    // If this game was created via the Remix flow, points at the source game.
    // No FK reference here — self-references in Drizzle require ordering
    // gymnastics, and SQLite enforcement is unnecessary for a soft pointer.
    remixedFromGameId: text("remixed_from_game_id"),
    // Discover-page metrics. playCount is incremented on each public-play
    // request (rate-limited per IP+slug); likeCount is the count of rows
    // in game_likes pointing at this game and is denormalized for fast
    // sort-by-likes queries. Both default to 0.
    playCount: integer("play_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_games_user_id").on(table.userId),
    // Discover queries filter on isPublic and order by likeCount/publishedAt.
    // A composite index on (is_public, published_at) covers the "newest" sort
    // and keeps "trending"/"top" within bounds (both rank within the
    // is_public=true subset).
    index("idx_games_public_published").on(table.isPublic, table.publishedAt),
    // Genre-filtered Discover ("?genre=shooter") adds an equality predicate on
    // genre to the is_public filter and orders by published_at. The
    // (is_public, published_at) index above can't serve the genre equality, so
    // that query degrades to a scan-and-filter as the table grows. Lead with
    // genre (the equality predicate), then is_public, then published_at for the
    // ORDER BY.
    index("idx_games_genre_public_published").on(table.genre, table.isPublic, table.publishedAt),
  ]
);

// game_likes — one row per (user, game). Server enforces uniqueness via
// (gameId, userId) primary-key-shaped index plus an INSERT OR IGNORE so
// double-clicks coalesce. Denormalized counter on games.likeCount stays
// in sync via the same transaction that inserts/deletes here.
export const gameLikes = sqliteTable(
  "game_likes",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_game_likes_unique").on(table.gameId, table.userId),
    index("idx_game_likes_user").on(table.userId),
  ]
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MESSAGE_KIND_VALUES }).notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_messages_game_id").on(table.gameId)]
);

export const usageLog = sqliteTable(
  "usage_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: text("game_id").references(() => games.id, { onDelete: "set null" }),
    action: text("action", { enum: USAGE_ACTION_VALUES }).notNull(),
    creditsCharged: integer("credits_charged").notNull(),
    // True if this deduct also incremented the user's lifetime counter
    // (free tier + ENFORCE_LIFETIME_LIMITS_FOR_FREE). Refund consults this
    // to decide whether to decrement the counter back, independent of the
    // current tier or flag value (which may have changed since deduct).
    lifetimeCounterIncremented: integer("lifetime_counter_incremented", { mode: "boolean" })
      .notNull()
      .default(false),
    succeeded: integer("succeeded").notNull().default(0), // 0 or 1
    refundedAt: integer("refunded_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_usage_log_user_id_created_at").on(table.userId, table.createdAt),
    // GET /api/games/:id polls usage_log by game_id to surface in-flight
    // generation rows. Without this index the polling fires a full scan
    // every time the user refreshes a streaming game page.
    index("idx_usage_log_game_id").on(table.gameId),
  ]
);

export const ragExamples = sqliteTable("rag_examples", {
  id: text("id").primaryKey(),
  genre: text("genre", { enum: GENRE_VALUES }).notNull(),
  prompt: text("prompt").notNull(),
  html: text("html").notNull(),
  createdAt: integer("created_at").notNull(),
});
