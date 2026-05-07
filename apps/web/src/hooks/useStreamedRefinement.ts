import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

const API = "http://localhost:3000";

export type RefinementStatus = "idle" | "streaming" | "error";

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

export function useStreamedRefinement(gameId: string): StreamedRefinementState {
  const [status, setStatus] = useState<RefinementStatus>("idle");
  const [streamingCode, setStreamingCode] = useState("");
  const [finalCode, setFinalCode] = useState<string | null>(null);
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
      // Note: finalCode is intentionally NOT cleared here — keep the previous
      // refinement's code visible until the new stream produces enough chunks.

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

          if (res.status === 402) {
            const body = (await res.json()) as { error: string; resetAt: number };
            const resetDate = new Date(body.resetAt).toLocaleDateString();
            setStatus("error");
            setError(`Out of credits — resets ${resetDate}. Upgrade on /pricing.`);
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
                  // Server-side error refunds credits (SPEC §10) — refresh bars
                  queryClient.invalidateQueries({ queryKey: ["me"] });
                } else if (event === "done") {
                  terminated = true;
                  setStatus("idle");
                  // Promote accumulated streaming text into finalCode so the
                  // iframe keeps showing the refined game while the parent's
                  // ['game', id] query refetches. Then clear streamingCode.
                  setFinalCode(accumulated);
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

  return { status, streamingCode, finalCode, error, refine, stop, attachIframe };
}
