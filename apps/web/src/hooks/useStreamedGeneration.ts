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
        const iframe = iframeRef.current;

        // Thumbnail capture timing is delicate:
        //
        // 1. The iframe `srcDoc` was rewritten on the LAST streamed chunk,
        //    so the document is still parsing when `onDone` fires. The
        //    wrapper script (which listens for 'capture-thumbnail') has
        //    not been registered yet — a postMessage now would be dropped.
        // 2. Even after the load fires, the game's init() + first
        //    render() haven't run, so canvas.toDataURL() captures a blank
        //    black surface. We wait one more beat so the title screen is
        //    actually drawn.
        // 3. After the iframe responds with the data URL, the parent
        //    POSTs to /api/games/:id/thumbnail — we must give that POST
        //    time to start before navigating away (the component
        //    unmounts on route change and aborts in-flight fetches).
        //
        // The sequence: wait for iframe load → 600ms for first frame →
        // post capture-thumbnail → 600ms for round-trip + POST start →
        // navigate. Total ~1.2s after `done`. A timeout fallback handles
        // the case where `load` already fired before we attached the
        // listener (rare but possible if the iframe is small).
        const captureAndNavigate = () => {
          setTimeout(() => {
            if (iframe?.contentWindow) {
              iframe.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
            }
            setTimeout(() => {
              if (id) {
                void navigate({ to: "/game/$id", params: { id }, replace: true });
              }
            }, 600);
          }, 600);
        };

        if (!iframe) {
          // No iframe ref — just navigate. Edge case, should not happen
          // in normal flow because the iframe is mounted as soon as the
          // first chunk arrives.
          if (id) void navigate({ to: "/game/$id", params: { id }, replace: true });
          return;
        }

        // `load` fires after the freshly-replaced srcDoc finishes parsing
        // AND running its inline scripts (which includes the wrapper).
        // If it already fired before we attach the listener, the fallback
        // setTimeout kicks in.
        let started = false;
        const start = () => {
          if (started) return;
          started = true;
          iframe.removeEventListener("load", start);
          captureAndNavigate();
        };
        iframe.addEventListener("load", start);
        // Fallback: 1s timeout in case `load` already fired.
        setTimeout(start, 1000);
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
