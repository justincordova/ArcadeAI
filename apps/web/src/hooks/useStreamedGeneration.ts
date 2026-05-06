import { useCallback, useRef, useState } from "react";

const API = "http://localhost:3000";

export type StreamStatus = "idle" | "streaming" | "error";

export interface StreamedGenerationState {
  status: StreamStatus;
  gameId: string | null;
  code: string;
  error: string | null;
  start: (prompt: string) => void;
  stop: () => void;
}

export function useStreamedGeneration(): StreamedGenerationState {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [gameId, setGameId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback((prompt: string) => {
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

        if (!res.ok || !res.body) {
          setStatus("error");
          setError("Request failed");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

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
                window.history.replaceState(null, "", `/game/${parsed.gameId}`);
              } else if (event === "chunk") {
                setCode((prev) => prev + parsed.delta);
              } else if (event === "error") {
                setStatus("error");
                setError(parsed.message);
              } else if (event === "done") {
                setStatus("idle");
              }
            } catch {
              // ignore malformed frames
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    })();
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  return { status, gameId, code, error, start, stop };
}
