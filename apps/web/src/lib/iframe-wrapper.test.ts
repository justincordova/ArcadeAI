import { describe, expect, test } from "vitest";
import { WRAPPER_SCRIPT, injectWrapper } from "./iframe-wrapper.js";

const CSP_MARKER = 'http-equiv="Content-Security-Policy"';

describe("injectWrapper — CSP placement", () => {
  test("inserts CSP immediately after a lowercase <head>", () => {
    const html = "<!doctype html><html><head><title>g</title></head><body></body></html>";
    const out = injectWrapper(html);
    const headIdx = out.indexOf("<head>");
    const cspIdx = out.indexOf(CSP_MARKER);
    const titleIdx = out.indexOf("<title>");
    // CSP must sit between <head> and the first existing head child so the
    // browser sees it before any script could run.
    expect(cspIdx).toBeGreaterThan(headIdx);
    expect(cspIdx).toBeLessThan(titleIdx);
  });

  test("matches <HEAD> case-insensitively (documented past regression)", () => {
    // The old indexOf('<head>') missed uppercase tags and fell through to the
    // prepend branch, which put the meta before <!doctype> → quirks mode →
    // CSP ignored. This guards that exact regression.
    const html = "<!DOCTYPE html><HTML><HEAD></HEAD><BODY></BODY></HTML>";
    const out = injectWrapper(html);
    const cspIdx = out.indexOf(CSP_MARKER);
    const doctypeIdx = out.toLowerCase().indexOf("<!doctype");
    expect(cspIdx).toBeGreaterThan(-1);
    // CSP must NOT be prepended before the doctype.
    expect(cspIdx).toBeGreaterThan(doctypeIdx);
  });

  test("matches <head> with attributes", () => {
    const html = '<html><head class="x" data-y>z</head><body></body></html>';
    const out = injectWrapper(html);
    // The injected <meta> CSP tag must begin exactly after the opening
    // <head ...> tag, before its first child ("z").
    const headTagEnd = out.indexOf(">", out.indexOf("<head")) + 1;
    const metaIdx = out.indexOf("<meta", headTagEnd - 1);
    expect(metaIdx).toBe(headTagEnd);
    // And the CSP content sits inside that meta tag.
    expect(out.indexOf(CSP_MARKER)).toBeGreaterThan(headTagEnd);
  });

  test("prepends CSP when there is no <head>, no <html>, and no doctype", () => {
    const html = "<body><canvas></canvas></body>";
    const out = injectWrapper(html);
    // No structure at all → the meta CSP is prepended at the very start.
    expect(out.startsWith("<meta")).toBe(true);
    expect(out.includes(CSP_MARKER)).toBe(true);
  });

  test("inserts CSP after <html> when a doctype exists but no <head>", () => {
    // Browsers auto-create <head>, so models legitimately omit it. The old
    // fallback prepended the meta BEFORE <!doctype html> → quirks mode →
    // CSP silently ignored — the same failure documented for <HEAD>.
    const html = "<!doctype html><html><body><canvas></canvas></body></html>";
    const out = injectWrapper(html);
    const doctypeIdx = out.toLowerCase().indexOf("<!doctype");
    const htmlTagEnd = out.indexOf("<html>") + "<html>".length;
    const cspIdx = out.indexOf(CSP_MARKER);
    expect(doctypeIdx).toBe(0); // doctype still first → standards mode
    expect(out.indexOf("<meta", htmlTagEnd - 1)).toBe(htmlTagEnd);
    expect(cspIdx).toBeGreaterThan(htmlTagEnd);
  });

  test("inserts CSP after the doctype when there is no <html> tag either", () => {
    const html = "<!DOCTYPE html><body><canvas></canvas></body>";
    const out = injectWrapper(html);
    const cspIdx = out.indexOf(CSP_MARKER);
    // Doctype must remain the very first thing in the document.
    expect(out.toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(cspIdx).toBeGreaterThan(out.toLowerCase().indexOf("<!doctype"));
    expect(cspIdx).toBeLessThan(out.indexOf("<body>"));
  });
});

describe("WRAPPER_SCRIPT — paint signal", () => {
  test("posts a `rendered` signal after a double requestAnimationFrame", () => {
    // The thumbnail capture waits for this signal instead of a fixed timeout.
    expect(WRAPPER_SCRIPT).toContain("rendered");
    // Double rAF guarantees a committed paint before signaling.
    const rafCount = (WRAPPER_SCRIPT.match(/requestAnimationFrame/g) ?? []).length;
    expect(rafCount).toBeGreaterThanOrEqual(2);
  });

  test("still posts game-error and thumbnail messages", () => {
    expect(WRAPPER_SCRIPT).toContain("game-error");
    expect(WRAPPER_SCRIPT).toContain("capture-thumbnail");
    expect(WRAPPER_SCRIPT).toContain("thumbnail");
  });
});

describe("injectWrapper — script placement", () => {
  test("injects the wrapper script before the last </body>", () => {
    const html = "<html><head></head><body><canvas></canvas></body></html>";
    const out = injectWrapper(html);
    const scriptIdx = out.indexOf("window.addEventListener('error'");
    const bodyCloseIdx = out.indexOf("</body>");
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });

  test("appends the script when there is no </body>", () => {
    const html = "<html><head></head><body><canvas></canvas>";
    const out = injectWrapper(html);
    expect(out.includes(WRAPPER_SCRIPT)).toBe(true);
    // Script is appended at the very end.
    expect(out.trimEnd().endsWith("</script>")).toBe(true);
  });

  test("targets the LAST </body> when multiple appear in text", () => {
    // A game could print the literal string "</body>" in its own output.
    // The regex uses a negative lookahead to pick the final one.
    const html = "<html><body><pre>&lt;/body&gt; shown</pre></body></html>";
    const out = injectWrapper(html);
    const scriptIdx = out.indexOf("window.addEventListener('error'");
    const lastBodyClose = out.lastIndexOf("</body>");
    expect(scriptIdx).toBeLessThan(lastBodyClose);
  });
});
