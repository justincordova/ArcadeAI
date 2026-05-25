/**
 * Sanitize the raw streamed output of a generation/refinement/repair
 * call. The contract (see prompts/base.ts, prompts/refinement.ts,
 * prompts/repair.ts) is "output ONLY the raw HTML file, no explanation,
 * no markdown fences" — but the model occasionally violates this. The
 * two failure modes we see in practice:
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
 * We sanitize by locating the first `<!DOCTYPE` or `<html` tag
 * (case-insensitive) and discarding everything before it, then
 * trimming a trailing markdown fence if one survived.
 *
 * Returns null when no HTML opener is found — the caller treats this
 * the same as a stream error: no persistence, refund credits, surface
 * an error to the client.
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
  const trailingFenceMatch = trimmed.match(/\n```[a-zA-Z]*\s*$/);
  if (trailingFenceMatch) {
    trimmed = trimmed.slice(0, trailingFenceMatch.index).trimEnd();
  }

  return trimmed.length > 0 ? trimmed : null;
}
