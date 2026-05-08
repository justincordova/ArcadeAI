import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { type QuotaError, type SSEStatus, useSSEStream } from "./useSSEStream.js";

export type RefinementStatus = SSEStatus;

export interface StreamedRefinementState {
  status: RefinementStatus;
  // In-flight accumulated text while `status === 'streaming'`. Cleared on done.
  streamingCode: string;
  // Final code from the last successful refinement. Persists after streamingCode
  // clears so the iframe doesn't briefly flash back to pre-refinement code while
  // the parent's game query is being refetched.
  finalCode: string | null;
  error: string | null;
  refine: (feedback: string) => void;
  stop: () => void;
  attachIframe: (el: HTMLIFrameElement | null) => void;
}

function quotaMessage(body: QuotaError): string {
  if (body.kind === "lifetime" || body.resetAt === 0) {
    return "You've used your free trial. Upgrade on /pricing for more refinements.";
  }
  const resetDate = new Date(body.resetAt).toLocaleDateString();
  return `Out of credits — resets ${resetDate}. Upgrade on /pricing.`;
}

export function useStreamedRefinement(gameId: string): StreamedRefinementState {
  const [streamingCode, setStreamingCode] = useState("");
  const [finalCode, setFinalCode] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const accumulatedRef = useRef("");
  const queryClient = useQueryClient();

  const attachIframe = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const sse = useSSEStream({
    url: `/api/games/${gameId}/refine`,
    handlers: {
      onEvent(name, data) {
        const d = data as { delta?: string };
        if (name === "chunk" && typeof d.delta === "string") {
          accumulatedRef.current += d.delta;
          setStreamingCode(accumulatedRef.current);
        }
      },
      onQuotaExceeded: quotaMessage,
      onDone() {
        // Promote accumulated streaming text into finalCode so the
        // iframe keeps showing the refined game while the parent's
        // ['game', id] query refetches. Then clear streamingCode.
        setFinalCode(accumulatedRef.current);
        setStreamingCode("");

        // Trigger thumbnail capture after ~500ms
        setTimeout(() => {
          const iframe = iframeRef.current;
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
          }
        }, 500);

        // Invalidate game query so messages refetch, and me query
        // so the user dropdown's credit bars update (plan 7 §11)
        queryClient.invalidateQueries({ queryKey: ["game", gameId] });
        queryClient.invalidateQueries({ queryKey: ["me"] });
      },
      onError() {
        // Server-side error refunds credits (SPEC §10) — refresh bars
        queryClient.invalidateQueries({ queryKey: ["me"] });
      },
    },
  });

  const refine = useCallback(
    (feedback: string) => {
      // Note: finalCode is intentionally NOT cleared here — keep the previous
      // refinement's code visible until the new stream produces enough chunks.
      accumulatedRef.current = "";
      setStreamingCode("");
      sse.start({ feedback });
    },
    [sse]
  );

  const stop = useCallback(() => {
    sse.stop();
    setStreamingCode("");
  }, [sse]);

  return {
    status: sse.status,
    streamingCode,
    finalCode,
    error: sse.error,
    refine,
    stop,
    attachIframe,
  };
}
