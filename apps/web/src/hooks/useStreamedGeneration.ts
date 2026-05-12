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
  // Track the gameId outside React state so `onDone` can read the
  // freshest value synchronously even if it fires before a render flushes.
  const gameIdRef = useRef<string | null>(null);
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
          // Stash the gameId for `onDone` to read, but DO NOT navigate
          // here. Navigating mid-stream unmounts this component and the
          // hook's abort cleanup kills the in-flight fetch, dropping every
          // chunk that hasn't arrived yet. Wait for `done` to navigate.
          gameIdRef.current = d.gameId;
          setGameId(d.gameId);
        } else if (name === "chunk" && typeof d.delta === "string") {
          setCode((prev) => prev + (d.delta ?? ""));
        }
      },
      onQuotaExceeded: quotaMessage,
      onDone() {
        // Refresh credit bars in the user dropdown (plan 7 §11)
        queryClient.invalidateQueries({ queryKey: ["me"] });

        const id = gameIdRef.current;

        // Capture the thumbnail BEFORE navigating away. The iframe message
        // round-trips (parent → iframe → parent → POST /thumbnail) and
        // needs the iframe alive for the duration. We delay navigation
        // long enough for the capture to fire and the postThumbnail call
        // to start; the POST itself completes after navigation, which is
        // fine — it's a fire-and-forget against `gameId` already on disk.
        const iframe = iframeRef.current;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
        }

        // Navigate to the per-game URL once streaming has completed. The
        // 500ms delay matches the existing thumbnail capture timing and
        // gives the iframe enough time to respond + POST before its
        // parent component unmounts.
        setTimeout(() => {
          if (id) {
            void navigate({ to: "/game/$id", params: { id }, replace: true });
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
      gameIdRef.current = null;
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
