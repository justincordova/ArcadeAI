import { createClient } from "@arcadeai/db";
import { TIER_CREDIT_LIMITS } from "@arcadeai/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as schema from "../../../../packages/db/src/schema.js";
import {
  firstOfNextMonthUtcMs,
  isAdminEmail,
  nextUtcMidnightMs,
  randomHex,
} from "./auth-helpers.js";

const dbPath = process.env.DATABASE_PATH ?? "./apps/server/data/arcadeai.db";
const db = createClient(dbPath);

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:5173"],
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },
  user: {
    additionalFields: {
      display_name: {
        type: "string",
        required: false,
        defaultValue: "",
      },
      tier: {
        type: "string",
        required: false,
        defaultValue: "free",
      },
      credits_remaining_daily: {
        type: "number",
        required: false,
        defaultValue: 500,
      },
      credits_remaining_monthly: {
        type: "number",
        required: false,
        defaultValue: 3000,
      },
      daily_reset_at: {
        type: "number",
        required: false,
        defaultValue: 0,
      },
      monthly_reset_at: {
        type: "number",
        required: false,
        defaultValue: 0,
      },
      theme: {
        type: "string",
        required: false,
        defaultValue: "dark",
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const email = user.email ?? "";
          const name = user.name ?? "";
          const displayName = name.trim() || `user-${randomHex(4)}`;
          const tier = isAdminEmail(email) ? "admin" : "free";
          const caps = TIER_CREDIT_LIMITS[tier];
          const now = Date.now();

          return {
            data: {
              ...user,
              display_name: displayName,
              tier,
              credits_remaining_daily: caps.daily,
              credits_remaining_monthly: caps.monthly,
              daily_reset_at: nextUtcMidnightMs(now),
              monthly_reset_at: firstOfNextMonthUtcMs(now),
              theme: "dark",
            },
          };
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
