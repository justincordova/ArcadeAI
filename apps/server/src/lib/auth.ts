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
import { db } from "./db.js";

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
      displayName: {
        type: "string",
        required: false,
        defaultValue: "",
      },
      tier: {
        type: "string",
        required: false,
        defaultValue: "free",
      },
      creditsRemainingDaily: {
        type: "number",
        required: false,
        defaultValue: 500,
      },
      creditsRemainingMonthly: {
        type: "number",
        required: false,
        defaultValue: 3000,
      },
      dailyResetAt: {
        type: "number",
        required: false,
        defaultValue: 0,
      },
      monthlyResetAt: {
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
              displayName,
              tier,
              creditsRemainingDaily: caps.daily,
              creditsRemainingMonthly: caps.monthly,
              dailyResetAt: nextUtcMidnightMs(now),
              monthlyResetAt: firstOfNextMonthUtcMs(now),
              theme: "dark",
            },
          };
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
