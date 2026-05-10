// Inline diff display for the most-recent refinement turn. Sits under
// the AI summary bubble in the chat panel: collapsed by default to a
// "+12 −8" pill; expands into a line-by-line view when clicked.
//
// The diff is computed lazily on expand to keep the chat scroll cheap
// when nobody opens it. Only the live turn renders this component;
// historical turns just show the NL summary.

import { type DiffHunk, type DiffLine, compactDiff, computeLineDiff } from "@/lib/line-diff.js";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

interface DiffViewerProps {
  previousCode: string;
  newCode: string;
}

export function DiffViewer({ previousCode, newCode }: DiffViewerProps) {
  const [open, setOpen] = useState(false);

  const hunk: DiffHunk = useMemo(() => {
    if (!open) return { lines: [], added: 0, removed: 0 };
    return computeLineDiff(previousCode, newCode);
  }, [open, previousCode, newCode]);

  const compact: DiffLine[] = useMemo(() => compactDiff(hunk, 2), [hunk]);

  // Counts shown in the collapsed pill — compute on the always-cheap
  // path (a hash check plus length comparison) instead of triggering
  // the full LCS. We do a single quick pass to estimate added/removed
  // by comparing line sets so the pill renders without expansion.
  const summary = useMemo(() => quickCounts(previousCode, newCode), [previousCode, newCode]);

  if (summary.added === 0 && summary.removed === 0) return null;

  return (
    <div style={{ marginTop: 8, marginLeft: 0, maxWidth: "85%" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
          borderRadius: 9999,
          fontSize: 11,
          fontFamily: "IBM Plex Mono, ui-monospace, monospace",
          letterSpacing: "0.02em",
          color: "var(--color-text-secondary)",
          background: "var(--color-surface-raised)",
          border: "1px solid var(--color-border)",
          cursor: "pointer",
          transition: "all 0.12s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,62,165,0.35)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
        }}
      >
        <ChevronDown
          size={11}
          strokeWidth={2}
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        />
        <span style={{ color: "var(--color-success)" }}>+{summary.added}</span>
        <span style={{ color: "var(--color-danger)" }}>−{summary.removed}</span>
        <span>{open ? "Hide changes" : "Show changes"}</span>
      </button>

      {open && (
        <div
          style={{
            marginTop: 6,
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "var(--color-bg)",
            overflow: "hidden",
          }}
        >
          {compact.length === 0 ? (
            <p
              style={{
                fontSize: 11,
                fontFamily: "IBM Plex Mono, ui-monospace, monospace",
                color: "var(--color-text-muted)",
                padding: "10px 12px",
                margin: 0,
              }}
            >
              File too large to diff inline.
            </p>
          ) : (
            <pre
              style={{
                margin: 0,
                padding: "8px 0",
                fontSize: 11,
                lineHeight: 1.5,
                fontFamily: "IBM Plex Mono, ui-monospace, monospace",
                maxHeight: 360,
                overflow: "auto",
                whiteSpace: "pre",
              }}
            >
              {compact.map((line, idx) => (
                <DiffRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable order
                  key={idx}
                  line={line}
                />
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  // Color the row by kind. Mono background tints keep the gutter
  // readable in both themes via current var resolution.
  const isAdd = line.kind === "add";
  const isRemove = line.kind === "remove";
  const isEllipsis = line.text === "…" && line.oldLine === null && line.newLine === null;

  if (isEllipsis) {
    return (
      <div
        style={{
          padding: "0 12px",
          color: "var(--color-text-muted)",
          opacity: 0.7,
          textAlign: "center",
          fontSize: 10,
        }}
      >
        ⋯
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        background: isAdd
          ? "rgba(46,232,164,0.06)"
          : isRemove
            ? "rgba(255,77,109,0.06)"
            : "transparent",
        color: "var(--color-text-secondary)",
        paddingRight: 12,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 22,
          flexShrink: 0,
          textAlign: "center",
          color: isAdd
            ? "var(--color-success)"
            : isRemove
              ? "var(--color-danger)"
              : "var(--color-text-muted)",
          opacity: isAdd || isRemove ? 1 : 0.5,
          userSelect: "none",
        }}
      >
        {isAdd ? "+" : isRemove ? "−" : " "}
      </span>
      <span
        style={{
          flex: 1,
          color: isAdd
            ? "var(--color-text-primary)"
            : isRemove
              ? "var(--color-text-secondary)"
              : "var(--color-text-muted)",
          textDecoration: isRemove ? "line-through" : "none",
        }}
      >
        {line.text || "\u00a0"}
      </span>
    </div>
  );
}

/**
 * Cheap line-count estimation — just for the collapsed pill. A real diff
 * happens only on expansion. Returns 0/0 for identical strings so the
 * pill stays hidden.
 */
function quickCounts(oldText: string, newText: string): { added: number; removed: number } {
  if (oldText === newText) return { added: 0, removed: 0 };
  const oldSet = new Set(oldText.split("\n"));
  const newSet = new Set(newText.split("\n"));
  let added = 0;
  let removed = 0;
  for (const line of newSet) if (!oldSet.has(line)) added++;
  for (const line of oldSet) if (!newSet.has(line)) removed++;
  return { added, removed };
}
