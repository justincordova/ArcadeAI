import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { API_BASE } from "../lib/api/client.js";

const API = API_BASE;

export type StreamStatus = "idle" | "streaming" | "error";

export interface StreamedGenerationState {
  status: StreamStatus;
  gameId: string | null;
  code: string;
  error: string | null;
  start: (prompt: string) => void;
  stop: () => void;
  attachIframe: (ref: HTMLIFrameElement | null) => void;
}

export function useStreamedGeneration(): StreamedGenerationState {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [gameId, setGameId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const attachIframe = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const start = useCallback(
    (prompt: string) => {
      const ac = new AbortController();
      abortRef.current = ac;

      setStatus("streaming");
      setGameId(null);
      setCode("");
      setError(null);

      (async () => {
        try {
          const res = await fetch(`${API}/api/games`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
            signal: ac.signal,
          });

          if (res.status === 409) {
            const body = (await res.json()) as { error: string };
            setStatus("error");
            setError(body.error);
            return;
          }

          if (res.status === 402) {
            const body = (await res.json()) as {
              error: string;
              resetAt: number;
              kind?: "daily" | "monthly" | "lifetime";
            };
            setStatus("error");
            // Lifetime cap (resetAt === 0) is a hard cap — no reset; surface
            // an upgrade-only message instead of a fictional reset date.
            if (body.kind === "lifetime" || body.resetAt === 0) {
              setError("You've used your free trial. Upgrade on /pricing for more generations.");
            } else {
              const resetDate = new Date(body.resetAt).toLocaleDateString();
              setError(`Out of credits — resets ${resetDate}. Upgrade on /pricing.`);
            }
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
          let terminated = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            // Split on double newline (SSE frame boundary)
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
                if (event === "meta") {
                  setGameId(parsed.gameId);
                  void navigate({ to: "/game/$id", params: { id: parsed.gameId }, replace: true });
                } else if (event === "chunk") {
                  setCode((prev) => prev + parsed.delta);
                } else if (event === "error") {
                  terminated = true;
                  setStatus("error");
                  setError(parsed.message);
                  // Server-side error refunds credits (SPEC §10) — refresh bars
                  queryClient.invalidateQueries({ queryKey: ["me"] });
                } else if (event === "done") {
                  terminated = true;
                  setStatus("idle");
                  // Refresh credit bars in the user dropdown (plan 7 §11)
                  queryClient.invalidateQueries({ queryKey: ["me"] });
                  // Schedule thumbnail capture ~500ms after done
                  setTimeout(() => {
                    const iframe = iframeRef.current;
                    if (iframe?.contentWindow) {
                      iframe.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
                    }
                  }, 500);
                }
              } catch {
                // ignore malformed frames
              }
            }
          }

          // Stream ended without an explicit done/error event — treat as error
          // so the UI doesn't get stuck in the "streaming" state.
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
    [queryClient, navigate]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  return { status, gameId, code, error, start, stop, attachIframe };
}
