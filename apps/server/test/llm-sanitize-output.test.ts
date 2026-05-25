import { describe, expect, test } from "bun:test";
import { sanitizeHtmlOutput } from "../src/services/llm/sanitize-output.js";

describe("sanitizeHtmlOutput", () => {
  test("passes through a clean HTML document unchanged", () => {
    const html = "<!DOCTYPE html>\n<html><body>game</body></html>";
    expect(sanitizeHtmlOutput(html)).toBe(html);
  });

  test("strips a prose preamble before <!DOCTYPE", () => {
    // The exact failure mode from the squish-clamp repair bug.
    const raw =
      "The bug is that `squish` can become negative... The fix is to clamp.\n\n<!DOCTYPE html>\n<html><body>game</body></html>";
    expect(sanitizeHtmlOutput(raw)).toBe("<!DOCTYPE html>\n<html><body>game</body></html>");
  });

  test("strips a prose preamble before <html when no doctype is emitted", () => {
    const raw = "Here is the fixed game:\n\n<html><body>game</body></html>";
    expect(sanitizeHtmlOutput(raw)).toBe("<html><body>game</body></html>");
  });

  test("strips markdown fences wrapping the HTML", () => {
    const raw = "```html\n<!DOCTYPE html>\n<html><body>game</body></html>\n```";
    expect(sanitizeHtmlOutput(raw)).toBe("<!DOCTYPE html>\n<html><body>game</body></html>");
  });

  test("strips a prose preamble and a trailing fence", () => {
    const raw = "Here is the fix:\n```html\n<!DOCTYPE html>\n<html></html>\n```";
    const out = sanitizeHtmlOutput(raw);
    expect(out).toBe("<!DOCTYPE html>\n<html></html>");
  });

  test("preserves three-backtick sequences inside the document body", () => {
    // Regression: previously the sanitizer truncated at the FIRST `` ``` ``
    // it saw after the opener, mangling any game that legitimately contained
    // a fenced code sample (programming themes, tutorial UIs, etc.).
    const raw =
      "<!DOCTYPE html>\n<html><body><pre>```js\nconsole.log('hi')\n```</pre></body></html>";
    const out = sanitizeHtmlOutput(raw);
    expect(out).toBe(raw);
  });

  test("is case-insensitive on the doctype tag", () => {
    const raw = "intro\n<!doctype html>\n<html></html>";
    const out = sanitizeHtmlOutput(raw);
    expect(out?.startsWith("<!doctype html>")).toBe(true);
  });

  test("prefers the earliest of <!DOCTYPE or <html", () => {
    // <html appears before <!DOCTYPE in the (malformed) raw output —
    // we should anchor on whichever comes first to avoid dropping
    // real content.
    const raw = "preamble <html><!DOCTYPE html></html>";
    const out = sanitizeHtmlOutput(raw);
    expect(out).toBe("<html><!DOCTYPE html></html>");
  });

  test("returns null when no HTML opener is found", () => {
    expect(sanitizeHtmlOutput("just a paragraph of prose")).toBeNull();
  });

  test("returns null on empty input", () => {
    expect(sanitizeHtmlOutput("")).toBeNull();
  });

  test("returns null when only whitespace remains after stripping", () => {
    // Edge case: doctype tag with nothing else. We don't try to validate
    // structural completeness — that's the iframe's job — but an empty
    // shell is preserved.
    expect(sanitizeHtmlOutput("<!DOCTYPE html>")).toBe("<!DOCTYPE html>");
  });
});
