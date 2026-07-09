// Better Auth configuration: Google + GitHub OAuth with account linking,
// backed by the Drizzle adapter. Throws at import time in production if
// BETTER_AUTH_SECRET is unset (see guard below) so the server never boots
// with a forgeable session secret.
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

if (!process.env.BETTER_AUTH_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "BETTER_AUTH_SECRET is not set. Sessions would be signed with a public fallback, allowing forgery. Set BETTER_AUTH_SECRET in your environment."
  );
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  // Same trailing-slash normalization as env.ts's WEB_ORIGIN — origins are
  // compared exactly, and this module reads process.env directly because it
  // constructs at import time (before loadEnv's transformed copy exists).
  trustedOrigins: [(process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/+$/, "")],
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
  // Enable /api/auth/link-social so the Settings → Connected Accounts
  // "Connect" buttons can attach a second provider to an existing user
  // (SPEC §11, plan 12 §4). trustedProviders ensures the user lands back
  // on the web origin after the OAuth dance.
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "github"],
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
      // Lifetime counters — declared here so Better Auth's session type
      // exposes them on `user.lifetime*Used`. No route reads them off the
      // session today (every credit check goes through applyResets which
      // hits the DB), but declaring them keeps the session shape and the
      // DB schema in sync, which avoids a category of future-maintainer
      // surprises.
      lifetimeGenerationsUsed: {
        type: "number",
        required: false,
        defaultValue: 0,
      },
      lifetimeRefinementsUsed: {
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
