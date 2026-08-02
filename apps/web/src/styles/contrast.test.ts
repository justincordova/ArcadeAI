// Guards the theme's text/surface contrast ratios against WCAG AA.
//
// This exists because --color-text-muted once shipped at #4f4d65, which
// measures 2.1–2.5:1 against the dark surfaces and is effectively
// unreadable — yet it carries real content (timestamps, cost lines,
// empty-state copy) in ~60 places. A token nudged "just a little darker
// for hierarchy" is an easy and completely invisible regression to make,
// so the ratios are asserted rather than eyeballed.
//
// The test parses the real stylesheet instead of duplicating the hex
// values, so editing index.css is what the assertion actually checks.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");

/** Pull `--name: #rrggbb;` out of a given block. */
function readTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--color-[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    out[m[1] as string] = (m[2] as string).toLowerCase();
  }
  return out;
}

/** Extract the body of a top-level CSS block by selector. */
function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector ${selector} not found in index.css`);
  const open = css.indexOf("{", start);
  const end = css.indexOf("\n}", open);
  return css.slice(open, end);
}

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
  const ch = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = [
  "--color-bg",
  "--color-surface",
  "--color-surface-raised",
  "--color-surface-overlay",
] as const;

// Every tier here renders body copy somewhere, so all three are held to
// the 4.5:1 normal-text bar rather than the 3:1 UI-component bar.
const TEXT_TIERS = [
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-muted",
] as const;

describe.each([
  ["dark", ":root {"],
  ["light", ".light {"],
])("%s theme — text on every surface meets WCAG AA (4.5:1)", (_name, selector) => {
  const tokens = readTokens(block(selector));

  test.each(
    TEXT_TIERS.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as const))
  )("%s on %s", (fg, bg) => {
    const fgHex = tokens[fg];
    const bgHex = tokens[bg];
    expect(fgHex, `${fg} missing from ${selector}`).toBeDefined();
    expect(bgHex, `${bg} missing from ${selector}`).toBeDefined();
    expect(contrast(fgHex as string, bgHex as string)).toBeGreaterThanOrEqual(4.5);
  });

  test("tiers stay visually distinct so hierarchy survives the contrast floor", () => {
    // Raising a failing tier is tempting to do by shoving it at the primary
    // colour, which passes the check above while flattening the type scale.
    // Require a real luminance gap between adjacent tiers.
    const ratio = (t: string) => contrast(tokens[t] as string, tokens["--color-bg"] as string);
    expect(ratio("--color-text-primary")).toBeGreaterThan(ratio("--color-text-secondary") * 1.3);
    expect(ratio("--color-text-secondary")).toBeGreaterThan(ratio("--color-text-muted") * 1.2);
  });
});
