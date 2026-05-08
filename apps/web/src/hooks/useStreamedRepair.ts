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
