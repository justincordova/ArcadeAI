import { describe, expect, test } from "vitest";
import { formatRelative } from "./format-time.js";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// formatRelative reads Date.now() internally, so build inputs relative to it.
const ago = (ms: number) => Date.now() - ms;

describe("formatRelative — buckets", () => {
  test("under a minute reads 'just now'", () => {
    expect(formatRelative(ago(0))).toBe("just now");
    expect(formatRelative(ago(59 * SECOND))).toBe("just now");
  });

  test("minutes for < 1 hour", () => {
    // numeric:"auto" renders 1 minute as "1 minute ago" (not "a minute ago").
    expect(formatRelative(ago(5 * MINUTE))).toBe("5 minutes ago");
    expect(formatRelative(ago(59 * MINUTE))).toBe("59 minutes ago");
  });

  test("hours for < 1 day", () => {
    expect(formatRelative(ago(3 * HOUR))).toBe("3 hours ago");
  });

  test("days beyond 24h; numeric:'auto' renders 1 day as 'yesterday'", () => {
    expect(formatRelative(ago(1 * DAY))).toBe("yesterday");
    expect(formatRelative(ago(4 * DAY))).toBe("4 days ago");
  });
});

describe("formatRelative — bucket boundaries", () => {
  test("exactly 60s crosses out of 'just now' into minutes", () => {
    expect(formatRelative(ago(MINUTE))).toBe("1 minute ago");
  });

  test("exactly 1h crosses into hours", () => {
    expect(formatRelative(ago(HOUR))).toBe("1 hour ago");
  });
});
