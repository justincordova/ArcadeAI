import { randomBytes } from "node:crypto";
import { nextUtcMidnight, nextUtcMonthStart } from "../services/usage/reset.js";

// Re-export under the names used by auth.ts to avoid a breaking rename.
export const nextUtcMidnightMs = nextUtcMidnight;
export const firstOfNextMonthUtcMs = nextUtcMonthStart;

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function isAdminEmail(email: string): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.toLowerCase());
}
