import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  tier: text("tier").notNull().default("free"), // 'free' | 'creator' | 'pro' | 'admin'
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
  theme: text("theme").notNull().default("dark"), // 'dark' | 'light' | 'system'
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const sessions = sqliteTable("session", {
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
});

export const accounts = sqliteTable("account", {
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
});

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
    genre: text("genre"),
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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_games_user_id").on(table.userId)]
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'prompt' | 'feedback'
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
    action: text("action").notNull(), // 'generation' | 'refinement' | 'repair'
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
  (table) => [index("idx_usage_log_user_id_created_at").on(table.userId, table.createdAt)]
);

export const ragExamples = sqliteTable("rag_examples", {
  id: text("id").primaryKey(),
  genre: text("genre").notNull(),
  prompt: text("prompt").notNull(),
  html: text("html").notNull(),
  createdAt: integer("created_at").notNull(),
});
