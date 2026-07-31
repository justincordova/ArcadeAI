/**
 * Sanitize the raw streamed output of a generation/refinement/repair
 * call. The contract (see the server's prompts) is "output ONLY the raw
 * HTML file, no explanation, no markdown fences" — but the model
 * occasionally violates this. The failure modes we see in practice:
 *
 *   1. A prose preamble before the HTML. Example: a repair call returned
 *      "The bug is that `squish` can become negative... The fix is to
 *      clamp..." followed by the `<!DOCTYPE html>` and the full file.
 *      Saving the prose preamble verbatim means the browser parses it
 *      as visible text content above the canvas, breaking the game.
 *
 *   2. Markdown code fences wrapping the HTML. Example:
 *      "```html\n<!DOCTYPE html>...\n```" — the backticks survive
 *      into srcDoc and break parsing.
 *
 *   3. A prose postamble after `</html>` ("I also added a power-up!").
 *      Browsers hoist post-`</html>` text back into the body, so it
 *      renders on top of the game exactly like a preamble would.
 *
 * We sanitize by locating the first `<!DOCTYPE` or `<html` tag
 * (case-insensitive) and discarding everything before it, then truncating
 * at the last `</html>` — which also removes a trailing fence. Output with
 * no closing tag falls through to explicit trailing-fence trimming.
 *
 * Returns null when no HTML opener is found — the server treats this the
 * same as a stream error (no persistence, refund, surface an error). It
 * lives in @arcadeai/shared so the client can apply the EXACT same
 * sanitization to streamed repair output before rendering it in the
 * iframe — otherwise the live preview would show the raw prose/fences
 * that the server strips before persisting, diverging from the saved game.
 */
export function sanitizeHtmlOutput(raw: string): string | null {
  if (!raw) return null;

  // Find the earliest viable HTML opener. We tolerate either <!DOCTYPE
  // (the contract-prescribed form) or a bare <html tag (sometimes
  // emitted without a doctype, still parseable).
  const doctypeIdx = raw.search(/<!doctype\b/i);
  const htmlIdx = raw.search(/<html\b/i);

  const candidates = [doctypeIdx, htmlIdx].filter((i) => i >= 0);
  if (candidates.length === 0) return null;

  const start = Math.min(...candidates);
  let trimmed = raw.slice(start).trimEnd();

  // Drop any postamble after the closing </html>. The model sometimes appends
  // a trailing explanation ("I also added a bonus power-up!"), and browsers
  // hoist post-</html> text back into the body, so it renders on top of the
  // game exactly like a preamble would. This also removes a trailing markdown
  // fence for free.
  //
  // Anchoring on the LAST </html> is what makes this safe for a game that
  // contains the literal string "</html>" in its own source (e.g. inside a
  // document.write call): in a well-formed document the real closing tag is
  // last, so the literal necessarily precedes it. The residual risk is output
  // that contains such a literal but never emits its own closing tag — that
  // gets truncated at the literal. Such output is already a truncated or
  // malformed stream, and the caller treats a broken document as a stream
  // error, so this does not turn a working game into a broken one.
  const closeIdx = trimmed.toLowerCase().lastIndexOf("</html>");
  if (closeIdx >= 0) {
    return trimmed.slice(0, closeIdx + "</html>".length);
  }

  // Strip a TRAILING markdown fence only. Older logic truncated at the
  // first `` ``` `` substring anywhere after the opener — but games can
  // legitimately contain three-backtick sequences in string literals,
  // rendered text, or comments (e.g. a programming-themed game showing
  // `"```js"`). The earlier behavior sliced those mid-document, producing
  // broken HTML. The safe path is: only trim a fence that sits at the
  // very end of the output (after the closing </html>), since that's the
  // only failure mode we're actually observing.
  //
  // Match any trailing fence with optional language tag and surrounding
  // whitespace: "\n```", "\n```\n", "```html\n...\n```" etc. We don't try
  // to handle every weird wrapper — just the common "model wrapped output
  // in a single fence block" case.
  //
  // The leading newline is optional: a fence appended directly to the last
  // tag ("...</body>```") has no separator, and requiring one left the
  // backticks in the persisted document.
  const trailingFenceMatch = trimmed.match(/\n?```[a-zA-Z]*\s*$/);
  if (trailingFenceMatch) {
    trimmed = trimmed.slice(0, trailingFenceMatch.index).trimEnd();
  }

  return trimmed.length > 0 ? trimmed : null;
}
