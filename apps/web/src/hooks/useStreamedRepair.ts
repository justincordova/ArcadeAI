import { useCallback, useRef, useState } from "react";

const API = "http://localhost:3000";

export type RepairStatus = "idle" | "streaming" | "error";

export interface StreamedRepairState {
  status: RepairStatus;
  code: string | null;
  error: string | null;
  start: (args: { error: { message: string; stack?: string } }) => void;
  stop: () => void;
}

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

export function useStreamedRepair(gameId: string): StreamedRepairState {
  const [status, setStatus] = useState<RepairStatus>("idle");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    (args: { error: { message: string; stack?: string } }) => {
      const ac = new AbortController();
      abortRef.current = ac;

      setStatus("streaming");
      setCode(null);
      setError(null);

      (async () => {
        try {
          const res = await fetch(`${API}/api/games/${gameId}/repair`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: args.error }),
            signal: ac.signal,
          });

          if (res.status === 409) {
            const body = (await res.json()) as { error: string };
            throw new ConcurrencyError(body.error);
          }

          if (!res.ok || !res.body) {
            setStatus("error");
            setError("Repair request failed");
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
                  setCode(accumulated);
                } else if (event === "done") {
                  terminated = true;
                  setStatus("idle");
                } else if (event === "error") {
                  terminated = true;
                  setStatus("error");
                  setError(parsed.message);
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
          if (err instanceof ConcurrencyError) throw err;
          setStatus("error");
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      })();
    },
    [gameId]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  return { status, code, error, start, stop };
}
