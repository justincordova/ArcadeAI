import type { FastifyReply, FastifyRequest } from "fastify";

export function writeSSEHeaders(reply: FastifyReply, request: FastifyRequest) {
  const allowedOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const requestOrigin = request.headers.origin ?? "";
  // Only reflect the origin if it matches the configured allowed origin.
  // Falling back to the allowed origin directly would open the SSE stream
  // to any origin that gets past the browser's CORS preflight.
  const responseOrigin = requestOrigin === allowedOrigin ? allowedOrigin : "";

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...(responseOrigin
      ? {
          "Access-Control-Allow-Origin": responseOrigin,
          "Access-Control-Allow-Credentials": "true",
        }
      : {}),
  });
  reply.raw.flushHeaders();
}

export function writeSSE(reply: FastifyReply, event: string, data: unknown) {
  // Guard against writing to a socket that the client has already torn
  // down. `reply.raw.destroyed` flips synchronously inside Node when the
  // peer's FIN/RST arrives — the `request.raw.on("close")` listener that
  // the SSE routes register flips a separate flag, but there's a small
  // window where the event has fired but the listener hasn't run yet
  // (or vice versa). Without this guard, a transient mid-chunk write
  // failure throws ERR_STREAM_WRITE_AFTER_END, which the route catches
  // as a stream error — refunding credits and abandoning generation
  // work that the LLM is still producing.
  if (reply.raw.destroyed || reply.raw.writableEnded) return;
  // JSON.stringify can throw on circular references — LLM SDK errors and
  // certain object graphs (Response/Request, async generators, etc.) carry
  // cause-chain refs that loop. Fall back to a generic frame so the route
  // doesn't crash mid-stream and abandon the connection without a
  // terminator frame.
  let payload: string;
  try {
    payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  } catch {
    payload = `event: ${event}\ndata: ${JSON.stringify({ message: "Serialization failed" })}\n\n`;
  }
  try {
    reply.raw.write(payload);
  } catch {
    // Socket closed mid-write; treat as a non-fatal disconnect. The
    // route's close handler / finally block owns cleanup.
  }
}

export function endSSE(reply: FastifyReply) {
  if (reply.raw.destroyed || reply.raw.writableEnded) return;
  try {
    reply.raw.end();
  } catch {
    // Socket already closed; ignore.
  }
}

/**
 * Default heartbeat interval. Most intermediate proxies (CDNs, ingress
 * controllers, load balancers) cut idle TCP connections after 30-60 seconds.
 * 15s is a safe default that doesn't add meaningful bandwidth overhead.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Start writing SSE comment frames (`:keep-alive\n\n`) at a regular interval
 * to keep the connection warm against idle timeouts. Returns a stop function
 * the caller MUST call when the stream ends or errors — typically inside
 * the same `finally` block that releases the concurrency lock.
 *
 * The frame is a comment per the EventSource spec — clients ignore it.
 */
export function startHeartbeat(
  reply: FastifyReply,
  intervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS
): () => void {
  const handle = setInterval(() => {
    // If the underlying socket has been destroyed (client disconnected),
    // writing throws — guard so we don't crash the route.
    if (reply.raw.destroyed) return;
    try {
      reply.raw.write(":keep-alive\n\n");
    } catch {
      // Socket closed mid-write; the route's close handler will release
      // resources. Nothing to do here.
    }
  }, intervalMs);

  return () => clearInterval(handle);
}
