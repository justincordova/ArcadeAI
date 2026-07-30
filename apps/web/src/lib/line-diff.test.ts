import { describe, expect, test } from "vitest";
import { computeLineDiff } from "./line-diff.js";

describe("computeLineDiff — basics", () => {
  test("identical strings produce an empty hunk", () => {
    expect(computeLineDiff("a\nb", "a\nb")).toEqual({ lines: [], added: 0, removed: 0 });
  });

  test("counts a pure addition", () => {
    const d = computeLineDiff("a", "a\nb");
    expect({ added: d.added, removed: d.removed }).toEqual({ added: 1, removed: 0 });
  });

  test("counts a pure removal", () => {
    const d = computeLineDiff("a\nb", "a");
    expect({ added: d.added, removed: d.removed }).toEqual({ added: 0, removed: 1 });
  });

  test("counts a replacement as one add and one remove", () => {
    const d = computeLineDiff("a\nb", "a\nc");
    expect({ added: d.added, removed: d.removed }).toEqual({ added: 1, removed: 1 });
  });
});

describe("computeLineDiff — empty sides", () => {
  // "".split("\n") is [""], so an empty document used to be modeled as one
  // empty line, yielding a phantom row and an off-by-one in the counts.
  test("empty -> content is all additions, with no phantom removal", () => {
    const d = computeLineDiff("", "a\nb");
    expect({ added: d.added, removed: d.removed }).toEqual({ added: 2, removed: 0 });
    expect(d.lines.every((l) => l.text !== "")).toBe(true);
  });

  test("content -> empty is all removals, with no phantom addition", () => {
    const d = computeLineDiff("a\nb", "");
    expect({ added: d.added, removed: d.removed }).toEqual({ added: 0, removed: 2 });
    expect(d.lines.every((l) => l.text !== "")).toBe(true);
  });

  test("empty -> empty produces an empty hunk", () => {
    expect(computeLineDiff("", "")).toEqual({ lines: [], added: 0, removed: 0 });
  });

  // A genuinely lost trailing newline is a real removed line, not a phantom.
  test("losing a trailing newline still counts as a removal", () => {
    const d = computeLineDiff("a\n", "a");
    expect({ added: d.added, removed: d.removed }).toEqual({ added: 0, removed: 1 });
  });
});

describe("computeLineDiff — size guard", () => {
  test("returns an empty hunk when the LCS table would be too large", () => {
    const big = Array(3000).fill("x").join("\n");
    expect(computeLineDiff(big, `${big}\nextra`)).toEqual({ lines: [], added: 0, removed: 0 });
  });
});
