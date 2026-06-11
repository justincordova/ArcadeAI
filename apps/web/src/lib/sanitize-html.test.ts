import { sanitizeHtmlOutput } from "@arcadeai/shared/sanitize-html.js";
import { describe, expect, test } from "vitest";

describe("sanitizeHtmlOutput — opener detection", () => {
  test("returns clean HTML unchanged (already starts with doctype)", () => {
    const html = "<!DOCTYPE html><html><body></body></html>";
    expect(sanitizeHtmlOutput(html)).toBe(html);
  });

  test("strips a prose preamble before <!DOCTYPE>", () => {
    const raw =
      "The bug is that squish can go negative. The fix clamps it.\n\n<!DOCTYPE html><html></html>";
    expect(sanitizeHtmlOutput(raw)).toBe("<!DOCTYPE html><html></html>");
  });

  test("strips a prose preamble before a bare <html> (no doctype)", () => {
    const raw = "Here you go:\n<html><body>x</body></html>";
    expect(sanitizeHtmlOutput(raw)).toBe("<html><body>x</body></html>");
  });

  test("picks the EARLIEST of <!doctype> and <html>", () => {
    const raw = "<!doctype html>\n<html></html>";
    // doctype comes first, so the whole thing is preserved.
    expect(sanitizeHtmlOutput(raw)).toBe("<!doctype html>\n<html></html>");
  });

  test("is case-insensitive on the opener", () => {
    const raw = "intro <!DoCtYpE html><HTML></HTML>";
    expect(sanitizeHtmlOutput(raw)).toBe("<!DoCtYpE html><HTML></HTML>");
  });

  test("returns null when no HTML opener exists", () => {
    expect(sanitizeHtmlOutput("just some prose, no html here")).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(sanitizeHtmlOutput("")).toBeNull();
  });
});

describe("sanitizeHtmlOutput — markdown fences", () => {
  test("strips a trailing ``` fence", () => {
    const raw = "<!DOCTYPE html><html></html>\n```";
    expect(sanitizeHtmlOutput(raw)).toBe("<!DOCTYPE html><html></html>");
  });

  test("strips a trailing fence with a language tag", () => {
    const raw = "```html\n<!DOCTYPE html><html></html>\n```";
    expect(sanitizeHtmlOutput(raw)).toBe("<!DOCTYPE html><html></html>");
  });

  test("does NOT strip backticks that appear inside the document body", () => {
    // A programming-themed game can legitimately render ``` in a string.
    // Only a trailing fence (after </html>) should be removed.
    const raw = "<!DOCTYPE html><html><body><pre>```js\nx()\n```</pre></body></html>";
    expect(sanitizeHtmlOutput(raw)).toBe(raw);
  });

  test("strips trailing fence but keeps an interior fence", () => {
    const raw = "<!DOCTYPE html><html><body><pre>```py</pre></body></html>\n```";
    expect(sanitizeHtmlOutput(raw)).toBe(
      "<!DOCTYPE html><html><body><pre>```py</pre></body></html>"
    );
  });
});
