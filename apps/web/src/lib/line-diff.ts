// Line-level diff. Implements the LCS-via-DP approach — fine for the
// typical 200-1000 line games we see. Produces a flat array of
// `DiffLine` entries in display order. Quadratic in line count, but the
// constant is tiny and we'd never run this on >2k-line files.
//
// Heavier/faster algorithms (Myers, Patience) aren't worth the bytes
// for this use case; we don't need the optimal diff, just "good
// enough that humans can read what changed."

export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-indexed line number on the old side (null for added lines). */
  oldLine: number | null;
  /** 1-indexed line number on the new side (null for removed lines). */
  newLine: number | null;
}

export interface DiffHunk {
  /** Display lines in order — context, removes, adds, etc. */
  lines: DiffLine[];
  /** Counts for the change-summary chip. */
  added: number;
  removed: number;
}

// Per-side line cap, and a cap on the LCS table area (m * n). The DP table is
// a Uint32Array of (m+1)*(n+1) cells and the fill loop runs m*n iterations on
// the UI thread, so the *product* is what actually bounds the work — a per-side
// limit of 4000 would still permit a 4000x4000 table (~64 MB, 16M iterations)
// and freeze the tab. Cap the area at ~2M cells (e.g. 2000x1000), matching the
// "we'd never run this on >2k-line files" assumption above.
const MAX_LINES = 4000;
const MAX_LCS_CELLS = 2_000_000;

/** Flat-array LCS table indexed as `i * (n + 1) + j`. Avoids the cost of
 *  nested arrays and the `!` non-null assertions that come with optional
 *  index access. Filled with zeros up front. */
function makeLcsTable(m: number, n: number): Uint32Array {
  return new Uint32Array((m + 1) * (n + 1));
}

/**
 * Diff two strings line-by-line. Returns an empty hunk when the strings
 * are identical or when either side exceeds MAX_LINES (a giant generated
 * file would otherwise stall the UI thread). Caller can show "no diff
 * available" in those cases.
 */
export function computeLineDiff(oldText: string, newText: string): DiffHunk {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  if (
    oldLines.length > MAX_LINES ||
    newLines.length > MAX_LINES ||
    oldLines.length * newLines.length > MAX_LCS_CELLS
  ) {
    return { lines: [], added: 0, removed: 0 };
  }
  if (oldText === newText) {
    return { lines: [], added: 0, removed: 0 };
  }

  const m = oldLines.length;
  const n = newLines.length;
  const stride = n + 1;
  const lcs = makeLcsTable(m, n);

  for (let i = 1; i <= m; i++) {
    const oldI = oldLines[i - 1] ?? "";
    for (let j = 1; j <= n; j++) {
      const newJ = newLines[j - 1] ?? "";
      if (oldI === newJ) {
        lcs[i * stride + j] = (lcs[(i - 1) * stride + (j - 1)] ?? 0) + 1;
      } else {
        const up = lcs[(i - 1) * stride + j] ?? 0;
        const left = lcs[i * stride + (j - 1)] ?? 0;
        lcs[i * stride + j] = up >= left ? up : left;
      }
    }
  }

  // Backtrack to produce the diff in reverse, then flip.
  const out: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const oldI = oldLines[i - 1] ?? "";
    const newJ = newLines[j - 1] ?? "";
    if (oldI === newJ) {
      out.push({ kind: "context", text: oldI, oldLine: i, newLine: j });
      i--;
      j--;
    } else {
      const up = lcs[(i - 1) * stride + j] ?? 0;
      const left = lcs[i * stride + (j - 1)] ?? 0;
      if (up >= left) {
        out.push({ kind: "remove", text: oldI, oldLine: i, newLine: null });
        i--;
      } else {
        out.push({ kind: "add", text: newJ, oldLine: null, newLine: j });
        j--;
      }
    }
  }
  while (i > 0) {
    out.push({
      kind: "remove",
      text: oldLines[i - 1] ?? "",
      oldLine: i,
      newLine: null,
    });
    i--;
  }
  while (j > 0) {
    out.push({
      kind: "add",
      text: newLines[j - 1] ?? "",
      oldLine: null,
      newLine: j,
    });
    j--;
  }

  out.reverse();

  let added = 0;
  let removed = 0;
  for (const l of out) {
    if (l.kind === "add") added++;
    else if (l.kind === "remove") removed++;
  }

  return { lines: out, added, removed };
}

/**
 * Trim the full diff to only show modified regions plus a few surrounding
 * context lines. Reduces the DOM size for large files where most of the
 * code is unchanged.
 */
export function compactDiff(hunk: DiffHunk, contextLines = 3): DiffLine[] {
  if (hunk.lines.length === 0) return [];

  const keep: boolean[] = new Array(hunk.lines.length).fill(false);
  for (let i = 0; i < hunk.lines.length; i++) {
    if (hunk.lines[i]?.kind !== "context") {
      const from = Math.max(0, i - contextLines);
      const to = Math.min(hunk.lines.length - 1, i + contextLines);
      for (let k = from; k <= to; k++) {
        keep[k] = true;
      }
    }
  }

  const out: DiffLine[] = [];
  let inGap = false;
  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    if (!line) continue;
    if (keep[i]) {
      if (inGap) {
        out.push({ kind: "context", text: "…", oldLine: null, newLine: null });
        inGap = false;
      }
      out.push(line);
    } else {
      inGap = true;
    }
  }
  return out;
}
