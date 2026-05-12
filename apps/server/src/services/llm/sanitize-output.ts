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
  let trimmed = raw.slice(start);

  // If a closing markdown fence appears anywhere after the opener, the
  // model wrapped the file in ```html ... ``` and possibly tacked on
  // a postamble after the closing fence. Truncate at the fence so the
  // postamble doesn't end up in the document.
  const fenceIdx = trimmed.indexOf("```");
  if (fenceIdx >= 0) {
    trimmed = trimmed.slice(0, fenceIdx);
  }

  // Trim trailing whitespace left behind by the slice or by the model.
  trimmed = trimmed.trimEnd();

  return trimmed.length > 0 ? trimmed : null;
}
