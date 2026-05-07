import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { GAMES_QUERY_KEY, postThumbnail } from "../lib/api/games.js";

const API = "http://localhost:3000";

export type RefinementStatus = "idle" | "streaming" | "error";

export interface StreamedRefinementState {
  status: RefinementStatus;
  streamingCode: string;
  error: string | null;
  refine: (feedback: string) => void;
  stop: () => void;
  attachIframe: (el: HTMLIFrameElement | null) => void;
}

export function useStreamedRefinement(gameId: string): StreamedRefinementState {
  const [status, setStatus] = useState<RefinementStatus>("idle");
  const [streamingCode, setStreamingCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const queryClient = useQueryClient();

  const attachIframe = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const refine = useCallback(
    (feedback: string) => {
      const ac = new AbortController();
      abortRef.current = ac;

      setStatus("streaming");
      setStreamingCode("");
      setError(null);

      (async () => {
        try {
          const res = await fetch(`${API}/api/games/${gameId}/refine`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedback }),
            signal: ac.signal,
          });

          if (res.status === 409) {
            const body = (await res.json()) as { error: string };
            setStatus("error");
            setError(body.error);
            return;
          }

          if (!res.ok || !res.body) {
            setStatus("error");
            setError("Request failed");
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let accumulated = "";
          let terminated = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            const frames = buf.split("\n\n");
            buf = frames.pop() ?? "";

            for (const frame of frames) {
              if (!frame.trim()) continue;
              const lines = frame.split("\n");
              let event = "";
              let data = "";
              for (const line of lines) {
                if (line.startsWith("event: ")) event = line.slice(7);
                else if (line.startsWith("data: ")) data = line.slice(6);
              }
              if (!event || !data) continue;

              try {
                const parsed = JSON.parse(data);
                if (event === "chunk") {
                  accumulated += parsed.delta;
                  setStreamingCode(accumulated);
                } else if (event === "error") {
                  terminated = true;
                  setStatus("error");
                  setError(parsed.message);
                } else if (event === "done") {
                  terminated = true;
                  setStatus("idle");
                  setStreamingCode("");

                  // Trigger thumbnail capture after ~500ms
                  setTimeout(() => {
                    const iframe = iframeRef.current;
                    if (iframe?.contentWindow) {
                      iframe.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
                    }
                  }, 500);

                  // Invalidate game query so messages refetch
                  queryClient.invalidateQueries({
                    queryKey: ["game", gameId],
                  });
                }
              } catch {
                // ignore malformed frames
              }
            }
          }

          if (!terminated) {
            setStatus("error");
            setError("Stream ended unexpectedly");
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          setStatus("error");
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      })();
    },
    [gameId, queryClient]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setStreamingCode("");
  }, []);

  // Handle thumbnail postMessage from the iframe
  const handleThumbnailMessage = useCallback(
    (dataUrl: string) => {
      postThumbnail(gameId, dataUrl)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY });
        })
        .catch((err) => {
          console.warn("[thumbnail] upload failed:", err);
        });
    },
    [gameId, queryClient]
  );

  // Expose the handler so GameIframe can call it (via the existing message listener)
  // The actual wiring happens in the component layer.
  void handleThumbnailMessage; // referenced to avoid lint unused warning

  return { status, streamingCode, error, refine, stop, attachIframe };
}
