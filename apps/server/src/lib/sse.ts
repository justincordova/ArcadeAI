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
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  reply.raw.write(payload);
}

export function endSSE(reply: FastifyReply) {
  reply.raw.end();
}
