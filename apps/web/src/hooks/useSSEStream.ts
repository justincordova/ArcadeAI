import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/api/client.js";

export type SSEStatus = "idle" | "streaming" | "error";

/**
 * 402 payload shape used by all credit-gated streaming endpoints. `kind`
 * distinguishes hard-cap exhaustion (lifetime, no reset) from window
 * exhaustion (daily/monthly, surfaces a reset date).
 */
export interface QuotaError {
  error: string;
  resetAt: number;
  kind?: "daily" | "monthly" | "lifetime";
}

/**
 * Per-event handler. Returning `true` from a terminal handler (done/error)
 * marks the stream as terminated so the "ended without terminator" guard
 * doesn't fire afterward.
 */
export interface SSEStreamHandlers {
  onEvent: (name: string, data: unknown) => void;
  /**
   * 409 — concurrent stream / busy. Return a string to override the
   * surfaced error message. Default surfaces `body.error`.
   */
  onConflict?: (body: { error: string }) => string | undefined;
  /**
   * 402 — out of credits / lifetime cap exhausted. Return a string to
   * override the surfaced error message.
   */
  onQuotaExceeded?: (body: QuotaError) => string | undefined;
  /** Terminal events — onEvent receives them too; these are a convenience. */
  onDone?: () => void;
  onError?: (message: string) => void;
}

interface UseSSEStreamOptions {
  /** Path or absolute URL. Path is resolved against `API_BASE`. */
  url: string;
  method?: "POST" | "GET";
  handlers: SSEStreamHandlers;
}

export interface UseSSEStream {
  status: SSEStatus;
  error: string | null;
  /** Start a stream. `body` is JSON-serialized when provided. */
  start: (body?: unknown) => void;
  stop: () => void;
}

/**
 * Shared SSE-streaming hook. Centralizes:
 *   - fetch + AbortController lifecycle (incl. unmount cleanup)
 *   - SSE frame parsing (event:/data: pairs split on \n\n)
 *   - `:` keep-alive heartbeat lines (per Milestone A) — silently ignored
 *   - 402/409/non-2xx HTTP status handling
 *   - "stream ended without terminator" detection
 *
 * Wrappers (useStreamedGeneration, useStreamedRefinement, useStreamedRepair)
 * provide endpoint-specific request shapes and event payload typing via
 * `handlers.onEvent`.
 */
export function useSSEStream(opts: UseSSEStreamOptions): UseSSEStream {
  const { url, method = "POST", handlers } = opts;
  const [status, setStatus] = useState<SSEStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Abort any in-flight stream on unmount. Without this, a navigation
  // mid-stream leaks the fetch and (worse) keeps writing to setState on an
  // unmounted component.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  const start = useCallback(
    (body?: unknown) => {
      // Abort any prior in-flight stream before starting a new one. Without
      // this, rapid re-entrant calls (e.g. React 18 strict-mode double-invoke
      // or back-to-back user submits) leak fetches and produce 409 races.
      abortRef.current?.abort();

      const ac = new AbortController();
      abortRef.current = ac;

      setStatus("streaming");
      setError(null);

      const target = url.startsWith("http") ? url : `${API_BASE}${url}`;

      (async () => {
        try {
          const init: RequestInit = {
            method,
            credentials: "include",
            signal: ac.signal,
          };
          if (body !== undefined) {
            init.headers = { "Content-Type": "application/json" };
            init.body = JSON.stringify(body);
          }

          const res = await fetch(target, init);

          if (res.status === 409) {
            const parsed = (await res.json().catch(() => ({ error: "Busy" }))) as {
              error: string;
            };
            const override = handlersRef.current.onConflict?.(parsed);
            setStatus("error");
            setError(override || parsed.error);
            return;
          }

          if (res.status === 402) {
            const parsed = (await res.json().catch(() => ({
              error: "Quota exceeded",
              resetAt: 0,
            }))) as QuotaError;
            const override = handlersRef.current.onQuotaExceeded?.(parsed);
            setStatus("error");
            setError(override || parsed.error);
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
              const trimmed = frame.trim();
              if (!trimmed) continue;
              // SSE comment / keep-alive heartbeat (sent by lib/sse.ts every
              // 15s in Milestone A). Skip without parsing.
              if (trimmed.startsWith(":")) continue;

              const lines = frame.split("\n");
              let event = "";
              let data = "";
              for (const line of lines) {
                if (line.startsWith("event: ")) event = line.slice(7);
                else if (line.startsWith("data: ")) data = line.slice(6);
              }
              if (!event || !data) continue;

              let parsed: unknown;
              try {
                parsed = JSON.parse(data);
              } catch {
                // ignore malformed frames
                continue;
              }

              handlersRef.current.onEvent(event, parsed);

              if (event === "done") {
                terminated = true;
                setStatus("idle");
                handlersRef.current.onDone?.();
              } else if (event === "error") {
                terminated = true;
                const msg =
                  typeof parsed === "object" && parsed && "message" in parsed
                    ? String((parsed as { message: unknown }).message)
                    : "Stream error";
                setStatus("error");
                setError(msg);
                handlersRef.current.onError?.(msg);
              }
            }
          }

          // Stream ended without an explicit done/error event — treat as error
          // so the UI doesn't get stuck in the "streaming" state.
          if (!terminated) {
            setStatus("error");
            setError("Stream ended unexpectedly");
            handlersRef.current.onError?.("Stream ended unexpectedly");
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Unknown error";
          setStatus("error");
          setError(msg);
          handlersRef.current.onError?.(msg);
        }
      })();
    },
    [url, method]
  );

  return { status, error, start, stop };
}
