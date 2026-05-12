// "What is the model writing right now" panel — always visible during a
// stream, rendered under the StreamingIndicator. Tails the last ~30 lines of
// in-flight HTML and auto-scrolls so the most recent bytes stay in view.

import { useEffect, useRef } from "react";

const TAIL_LINES = 30;

interface StreamingCodePreviewProps {
  code: string;
}

export function StreamingCodePreview({ code }: StreamingCodePreviewProps) {
  const preRef = useRef<HTMLPreElement>(null);

  // Auto-scroll on every new chunk so the latest bytes are always in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on `code` change is the whole point
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [code]);

  // Tail-slice the code to the last N lines. For an 8 KB game this is cheap;
  // for the rare 50 KB stream it's still O(length) but bounded by the cap
  // upstream. We compute on every render — `code` updates ~10x/sec at most.
  const tail = code ? lastNLines(code, TAIL_LINES) : "";

  return (
    <div
      style={{
        marginBottom: 16,
        borderRadius: 10,
        border: "1px solid var(--color-border)",
        background: "var(--color-surface-raised)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          color: "var(--color-text-secondary)",
          fontSize: 11,
        }}
      >
        <span style={{ letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>
          Source
        </span>
        <span style={{ marginLeft: "auto", color: "var(--color-text-muted)", fontSize: 10 }}>
          live
        </span>
      </div>
      <pre
        ref={preRef}
        style={{
          margin: 0,
          padding: "8px 12px",
          maxHeight: 180,
          overflow: "auto",
          background: "var(--color-bg)",
          borderTop: "1px solid var(--color-border)",
          fontSize: 10,
          lineHeight: 1.45,
          color: "var(--color-text-secondary)",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          whiteSpace: "pre",
        }}
      >
        {tail || "Waiting for first chunk…"}
      </pre>
    </div>
  );
}

/**
 * Slice the last `n` lines off a string without splitting the entire input.
 * Walks backward from the end counting `\n` so we don't allocate the full
 * line array — meaningful when the streaming buffer hits tens of KB.
 */
function lastNLines(s: string, n: number): string {
  if (n <= 0) return "";
  let count = 0;
  let i = s.length - 1;
  // Skip a trailing newline so it doesn't burn one of our N
  if (i >= 0 && s.charCodeAt(i) === 10) i--;
  while (i >= 0) {
    if (s.charCodeAt(i) === 10) {
      count++;
      if (count === n) return s.slice(i + 1);
    }
    i--;
  }
  return s; // fewer than N lines total
}
