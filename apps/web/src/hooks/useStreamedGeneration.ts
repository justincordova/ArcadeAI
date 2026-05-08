import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { type QuotaError, type SSEStatus, useSSEStream } from "./useSSEStream.js";

export type StreamStatus = SSEStatus;

export interface StreamedGenerationState {
  status: StreamStatus;
  gameId: string | null;
  code: string;
  error: string | null;
  start: (prompt: string) => void;
  stop: () => void;
  attachIframe: (ref: HTMLIFrameElement | null) => void;
}

function quotaMessage(body: QuotaError): string {
  if (body.kind === "lifetime" || body.resetAt === 0) {
    return "You've used your free trial. Upgrade on /pricing for more generations.";
  }
  const resetDate = new Date(body.resetAt).toLocaleDateString();
  return `Out of credits — resets ${resetDate}. Upgrade on /pricing.`;
}

export function useStreamedGeneration(): StreamedGenerationState {
  const [gameId, setGameId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const attachIframe = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const sse = useSSEStream({
    url: "/api/games",
    handlers: {
      onEvent(name, data) {
        const d = data as { gameId?: string; delta?: string };
        if (name === "meta" && d.gameId) {
          setGameId(d.gameId);
          void navigate({ to: "/game/$id", params: { id: d.gameId }, replace: true });
        } else if (name === "chunk" && typeof d.delta === "string") {
          setCode((prev) => prev + (d.delta ?? ""));
        }
      },
      onQuotaExceeded: quotaMessage,
      onDone() {
        // Refresh credit bars in the user dropdown (plan 7 §11)
        queryClient.invalidateQueries({ queryKey: ["me"] });
        // Schedule thumbnail capture ~500ms after done
        setTimeout(() => {
          const iframe = iframeRef.current;
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
          }
        }, 500);
      },
      onError() {
        // Server-side error refunds credits (SPEC §10) — refresh bars
        queryClient.invalidateQueries({ queryKey: ["me"] });
      },
    },
  });

  const start = useCallback(
    (prompt: string) => {
      setGameId(null);
      setCode("");
      sse.start({ prompt });
    },
    [sse]
  );

  return {
    status: sse.status,
    gameId,
    code,
    error: sse.error,
    start,
    stop: sse.stop,
    attachIframe,
  };
}
