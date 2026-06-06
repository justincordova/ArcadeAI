import { sanitizeHtmlOutput } from "@arcadeai/shared/sanitize-html.js";
import { useCallback, useRef, useState } from "react";
import { type SSEStatus, useSSEStream } from "./useSSEStream.js";

export type RepairStatus = SSEStatus;

export interface StreamedRepairState {
  status: RepairStatus;
  code: string | null;
  error: string | null;
  start: (args: { error: { message: string; stack?: string } }) => void;
  stop: () => void;
}

export function useStreamedRepair(gameId: string): StreamedRepairState {
  const [code, setCode] = useState<string | null>(null);
  const accumulatedRef = useRef("");

  const sse = useSSEStream({
    url: `/api/games/${gameId}/repair`,
    handlers: {
      onEvent(name, data) {
        const d = data as { delta?: string };
        if (name === "chunk" && typeof d.delta === "string") {
          accumulatedRef.current += d.delta;
          setCode(accumulatedRef.current);
        }
      },
      onDone() {
        // Sanitize the final repaired output the same way the server does
        // before persisting (strip a prose preamble / trailing markdown fence).
        // After the stream completes, RepairController applies this `code` via
        // onRepaired -> setRepairedCode, which sits ahead of finalCode in
        // Builder's displayCode precedence. Without sanitizing, the post-repair
        // preview and the captured thumbnail would render the raw prose the
        // server strips before persisting — diverging from the saved game.
        // Fall back to the raw accumulation if no HTML opener is found (the
        // stream errored anyway; nothing better to show).
        const sanitized = sanitizeHtmlOutput(accumulatedRef.current);
        if (sanitized) setCode(sanitized);
      },
    },
  });

  const start = useCallback(
    (args: { error: { message: string; stack?: string } }) => {
      accumulatedRef.current = "";
      setCode(null);
      sse.start({ error: args.error });
    },
    [sse]
  );

  return {
    status: sse.status,
    code,
    error: sse.error,
    start,
    stop: sse.stop,
  };
}
