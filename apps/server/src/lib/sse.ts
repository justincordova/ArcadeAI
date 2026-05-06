import type { FastifyReply } from "fastify";

export function writeSSEHeaders(reply: FastifyReply) {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": process.env.WEB_ORIGIN ?? "http://localhost:5173",
    "Access-Control-Allow-Credentials": "true",
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
