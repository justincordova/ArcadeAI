import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
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

  // The thumbnail-capture/navigate sequence in onDone schedules several
  // setTimeouts and a poll loop. If the component unmounts mid-sequence
  // (user navigates away), those callbacks would still fire — posting to a
  // detached iframe and calling navigate() after unmount. Track every timer
  // and a mounted flag so the unmount cleanup cancels them all.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current.clear();
    };
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

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

        // Thumbnail capture sequence:
        //
        // 1. The iframe only mounts AFTER this onDone returns and React
        //    re-renders with isStreaming=false (we defer srcDoc until
        //    streaming completes to avoid SyntaxErrors from partial
        //    HTML). So iframeRef.current is null right now; we have to
        //    poll for it to populate.
        // 2. Once the ref populates, wait for the iframe's `load` event
        //    so the wrapper script is registered and the canvas exists.
        // 3. Wait a beat for the game's init() + first render() to draw
        //    the title screen — else canvas.toDataURL captures blank
        //    black.
        // 4. postMessage('capture-thumbnail'), wait for the iframe to
        //    respond and the parent's POST /thumbnail to start.
        // 5. Navigate to /game/<id>. The POST completes against a row
        //    that exists on disk so it's safe even after this component
        //    unmounts.

        const captureAndNavigate = (iframe: HTMLIFrameElement) => {
          // Wait for the game's title screen to actually draw before
          // we ask for a snapshot.
          schedule(() => {
            const live = iframeRef.current;
            if (mountedRef.current && live?.contentWindow) {
              live.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
            }
            // Give the iframe time to respond and the parent's POST a
            // moment to start before we navigate away.
            schedule(() => {
              if (id && mountedRef.current) {
                void navigate({ to: "/game/$id", params: { id }, replace: true });
              }
            }, 600);
          }, 600);
        };

        const armCaptureOnLoad = (iframe: HTMLIFrameElement) => {
          // `load` fires after the iframe parses its srcDoc and runs
          // inline scripts (which includes the wrapper). If it already
          // fired before we attached, the fallback timeout kicks in.
          let started = false;
          const run = () => {
            if (started) return;
            started = true;
            iframe.removeEventListener("load", run);
            captureAndNavigate(iframe);
          };
          iframe.addEventListener("load", run);
          // Fallback: 1.5s in case load already fired between the React
          // commit and our event listener registration.
          schedule(run, 1500);
        };

        // Poll for the iframe to mount. Because the srcDoc-defer fix
        // moved iframe mount to AFTER onDone, the ref is reliably null
        // here. React typically commits the next render within one
        // tick, so usually the first or second poll succeeds.
        const startedAt = Date.now();
        const MAX_WAIT_MS = 3000;
        const POLL_INTERVAL_MS = 50;

        const waitForIframe = () => {
          if (!mountedRef.current) return;
          const iframe = iframeRef.current;
          if (iframe) {
            armCaptureOnLoad(iframe);
            return;
          }
          if (Date.now() - startedAt > MAX_WAIT_MS) {
            // Iframe never mounted (component unmounted, or some other
            // edge case). Skip capture and navigate so the user isn't
            // stranded on /game/new with a completed but un-navigated
            // stream. Thumbnail can still be regenerated by playing the
            // game and triggering a manual restart later.
            if (id && mountedRef.current) {
              void navigate({ to: "/game/$id", params: { id }, replace: true });
            }
            return;
          }
          schedule(waitForIframe, POLL_INTERVAL_MS);
        };

        waitForIframe();
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
