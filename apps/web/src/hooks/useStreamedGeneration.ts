import { sanitizeHtmlOutput } from "@arcadeai/shared/sanitize-html.js";
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
  // resetAt is a UTC boundary (midnight UTC). Render in UTC so the displayed
  // calendar day matches the actual reset and the "midnight UTC" tooltip copy,
  // rather than shifting a day earlier for users in timezones behind UTC.
  const resetDate = new Date(body.resetAt).toLocaleDateString(undefined, { timeZone: "UTC" });
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
  // Teardown callbacks for anything that isn't a timer (e.g. the `rendered`
  // window message listener), run on unmount so nothing leaks if the user
  // navigates away mid-capture.
  const cleanupsRef = useRef<Set<() => void>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    // Re-arm on every mount. StrictMode runs mount -> cleanup -> mount in
    // development, so without this the cleanup's `false` sticks for the
    // lifetime of the hook and every guarded call site below early-returns
    // forever — no thumbnail capture, and no navigate() to /game/$id once
    // generation finishes.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current.clear();
      for (const fn of cleanupsRef.current) fn();
      cleanupsRef.current.clear();
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

        // Sanitize the accumulated output the same way the server does before
        // persisting. The iframe (which mounts after this returns) renders this
        // `code` and the thumbnail is captured against it — without sanitizing,
        // a prose preamble / markdown fence would be baked into the persisted
        // thumbnail shown on the dashboard, discover, and og:image, even though
        // the saved game is clean. Fall back to raw if no HTML opener is found.
        setCode((prev) => sanitizeHtmlOutput(prev) ?? prev);

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
        // 3. Wait for the wrapper's `{type:'rendered'}` signal — posted
        //    after a double-rAF paint — so capture happens against real
        //    pixels instead of a fixed timeout (which captured blank black
        //    on slow machines). A timeout fallback fires capture anyway if
        //    the signal never arrives.
        // 4. postMessage('capture-thumbnail'), wait briefly for the iframe
        //    to respond and the parent's POST /thumbnail to start.
        // 5. Navigate to /game/<id>. The POST completes against a row
        //    that exists on disk so it's safe even after this component
        //    unmounts.

        // Max time to wait for the `rendered` paint signal before capturing
        // anyway. Generous enough for a slow first frame, short enough that a
        // signal-less game still navigates promptly.
        const RENDERED_FALLBACK_MS = 1200;
        // Beat between capture-thumbnail and navigation, so the iframe's
        // toDataURL round-trip and the parent's POST have a moment to start.
        const CAPTURE_TO_NAV_MS = 500;

        const captureAndNavigate = () => {
          const live = iframeRef.current;
          if (mountedRef.current && live?.contentWindow) {
            live.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
          }
          schedule(() => {
            if (id && mountedRef.current) {
              void navigate({ to: "/game/$id", params: { id }, replace: true });
            }
          }, CAPTURE_TO_NAV_MS);
        };

        const armCaptureOnLoad = (iframe: HTMLIFrameElement) => {
          // `load` fires after the iframe parses its srcDoc and runs inline
          // scripts (which includes the wrapper). Once loaded, wait for the
          // wrapper's paint signal (or the fallback) before capturing.
          let started = false;
          const begin = () => {
            // Bail if the component unmounted before `load` fired. Without this
            // guard, a `load` that arrives post-unmount would register the
            // `message` listener below into an already-drained cleanupsRef,
            // leaking it on window permanently. Mirrors the `cancelled` guard
            // in capture-thumbnail.ts's reference implementation.
            if (started || !mountedRef.current) return;
            started = true;
            detachLoad();
            cleanupsRef.current.delete(detachLoad);

            // Listen for the wrapper's paint signal, scoped to THIS iframe's
            // contentWindow so another frame can't spoof it (mirrors the
            // origin guard in GameIframe.tsx).
            const onRendered = (e: MessageEvent) => {
              if (e.source !== iframeRef.current?.contentWindow) return;
              if (e.data?.type === "rendered") fire();
            };
            window.addEventListener("message", onRendered);
            const removeRendered = () => window.removeEventListener("message", onRendered);
            cleanupsRef.current.add(removeRendered);

            // Latch the capture so the `rendered` signal and the fallback
            // timeout can't both fire it.
            let captured = false;
            const fire = () => {
              if (captured || !mountedRef.current) return;
              captured = true;
              removeRendered();
              cleanupsRef.current.delete(removeRendered);
              captureAndNavigate();
            };

            // Fallback: capture even if the signal never arrives.
            schedule(fire, RENDERED_FALLBACK_MS);
          };
          const onLoad = () => begin();
          iframe.addEventListener("load", onLoad);
          // Track the load-listener teardown in cleanupsRef so an unmount
          // before `begin` runs still removes it (matches capture-thumbnail.ts,
          // which tears down its detachLoad on cancel). begin() removes itself
          // from the set when it fires first.
          const detachLoad = () => iframe.removeEventListener("load", onLoad);
          cleanupsRef.current.add(detachLoad);
          // Fallback: 1.5s in case load already fired between the React commit
          // and our listener registration.
          schedule(begin, 1500);
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
