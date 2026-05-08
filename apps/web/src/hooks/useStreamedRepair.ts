import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/api/client.js";

const API = API_BASE;

export type RepairStatus = "idle" | "streaming" | "error";

export interface StreamedRepairState {
  status: RepairStatus;
  code: string | null;
  error: string | null;
  start: (args: { error: { message: string; stack?: string } }) => void;
  stop: () => void;
}

export function useStreamedRepair(gameId: string): StreamedRepairState {
  const [status, setStatus] = useState<RepairStatus>("idle");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const start = useCallback(
    (args: { error: { message: string; stack?: string } }) => {
      // Abort any prior in-flight stream before starting a new one.
      // Without this, rapid re-entrant calls (e.g. React 18 strict-mode
      // double-invoke) leak fetches and produce 409 races.
      abortRef.current?.abort();

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
            // Concurrency: another stream is in flight. Surface as a normal
            // error so the controller can clear the "repairing" overlay.
            // The iframe will re-throw if the bug persists, which advances
            // the attempt counter naturally.
            const body = (await res.json().catch(() => ({ error: "Busy" }))) as { error: string };
            setStatus("error");
            setError(body.error);
            return;
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
