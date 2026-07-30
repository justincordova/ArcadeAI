import { sanitizeHtmlOutput } from "@arcadeai/shared/sanitize-html.js";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureThumbnailWhenReady } from "@/lib/capture-thumbnail.js";
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
    // Trailing clause — see the matching note in useStreamedGeneration.
    return "You've used your free trial for refinements. Upgrade on /pricing.";
  }
  // resetAt is a UTC boundary (midnight UTC). Render in UTC so the displayed
  // calendar day matches the actual reset and the "midnight UTC" tooltip copy,
  // rather than shifting a day earlier for users in timezones behind UTC.
  const resetDate = new Date(body.resetAt).toLocaleDateString(undefined, { timeZone: "UTC" });
  return `Out of credits — resets ${resetDate}. Upgrade on /pricing.`;
}

export function useStreamedRefinement(gameId: string): StreamedRefinementState {
  const [streamingCode, setStreamingCode] = useState("");
  const [finalCode, setFinalCode] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const accumulatedRef = useRef("");
  const queryClient = useQueryClient();

  // Cancel handle for the post-done thumbnail capture sequence. Cancelled on
  // unmount (so no timer/listener fires against a detached iframe) and when
  // a new refinement starts (so a stale capture can't race the new stream).
  const cancelCaptureRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      cancelCaptureRef.current?.();
      cancelCaptureRef.current = null;
    };
  }, []);

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
          return;
        }
        // Diff summary lands after `done` (server emits done immediately
        // so the UI unlocks; the summary follows once GPT-mini returns).
        // Re-invalidate so the new `summary` message in the DB shows up
        // in the chat panel.
        if (name === "summary") {
          queryClient.invalidateQueries({ queryKey: ["game", gameId] });
        }
      },
      onQuotaExceeded: quotaMessage,
      onDone() {
        // Promote accumulated streaming text into finalCode so the
        // iframe keeps showing the refined game while the parent's
        // ['game', id] query refetches. Then clear streamingCode.
        //
        // Sanitize the same way the server does before persisting (strip a
        // prose preamble / trailing markdown fence). finalCode outranks the
        // server-sanitized initialCode in Builder's displayCode precedence and
        // also feeds the DiffViewer's "after" side, so without this a
        // contract-violating refinement would render raw prose over the canvas
        // and in the diff — diverging from the saved game. Fall back to raw if
        // no HTML opener is found.
        const sanitized = sanitizeHtmlOutput(accumulatedRef.current);
        setFinalCode(sanitized ?? accumulatedRef.current);
        setStreamingCode("");

        // Trigger thumbnail capture once the freshly-mounted iframe has
        // actually painted. The iframe is unmounted during streaming
        // (placeholder), so a blind 500ms timer here raced iframe mount +
        // srcDoc parse + first paint — the exact blank/stale-thumbnail
        // failure the generation path was hardened against.
        cancelCaptureRef.current?.();
        cancelCaptureRef.current = captureThumbnailWhenReady(() => iframeRef.current);

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
      // Kill any capture still pending from the previous turn — it would
      // otherwise fire against the mid-stream placeholder or the new code.
      cancelCaptureRef.current?.();
      cancelCaptureRef.current = null;
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
