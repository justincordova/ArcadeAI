// Tests for lib/sse.ts — origin validation in writeSSEHeaders and the
// heartbeat helper. We test against minimal stand-ins for FastifyReply /
// FastifyRequest because we only exercise reply.raw.write/writeHead and
// request.headers.origin.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _resetEnvForTests } from "../src/lib/env.js";
import { startHeartbeat, writeSSE, writeSSEHeaders } from "../src/lib/sse.js";

interface FakeRaw {
  written: string[];
  headers: Record<string, string | number | string[] | undefined> | null;
  destroyed: boolean;
  write(chunk: string): boolean;
  writeHead(code: number, headers: Record<string, string>): void;
  flushHeaders(): void;
  end(): void;
}

function makeFakeReply() {
  const raw: FakeRaw = {
    written: [],
    headers: null,
    destroyed: false,
    write(chunk: string) {
      this.written.push(chunk);
      return true;
    },
    writeHead(_code, headers) {
      this.headers = headers;
    },
    flushHeaders() {},
    end() {},
  };
  return { raw, getHeaders: () => ({}) };
}

function makeFakeRequest(origin: string | undefined) {
  return { headers: { origin } };
}

const ORIGINAL_WEB_ORIGIN = process.env.WEB_ORIGIN;
beforeEach(() => {
  // writeSSEHeaders reads the validated env via loadEnv() (memoized), so
  // reset the cache after mutating WEB_ORIGIN to force re-evaluation.
  process.env.WEB_ORIGIN = "http://localhost:5173";
  _resetEnvForTests();
});
afterEach(() => {
  if (ORIGINAL_WEB_ORIGIN === undefined) {
    process.env.WEB_ORIGIN = undefined;
  } else {
    process.env.WEB_ORIGIN = ORIGINAL_WEB_ORIGIN;
  }
  _resetEnvForTests();
});

describe("writeSSEHeaders — CORS origin validation", () => {
  test("reflects the matching origin and credentials when origin matches WEB_ORIGIN", () => {
    const reply = makeFakeReply();
    const request = makeFakeRequest("http://localhost:5173");
    // biome-ignore lint/suspicious/noExplicitAny: minimal test stand-in
    writeSSEHeaders(reply as any, request as any);
    expect(reply.raw.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
    expect(reply.raw.headers?.["Access-Control-Allow-Credentials"]).toBe("true");
  });

  test("omits CORS headers when origin does not match WEB_ORIGIN", () => {
    const reply = makeFakeReply();
    const request = makeFakeRequest("http://evil.example.com");
    // biome-ignore lint/suspicious/noExplicitAny: minimal test stand-in
    writeSSEHeaders(reply as any, request as any);
    expect(reply.raw.headers?.["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(reply.raw.headers?.["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  test("omits CORS headers when origin is missing entirely", () => {
    const reply = makeFakeReply();
    const request = makeFakeRequest(undefined);
    // biome-ignore lint/suspicious/noExplicitAny: minimal test stand-in
    writeSSEHeaders(reply as any, request as any);
    expect(reply.raw.headers?.["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  test("always sets the SSE content-type and cache headers", () => {
    const reply = makeFakeReply();
    const request = makeFakeRequest("http://localhost:5173");
    // biome-ignore lint/suspicious/noExplicitAny: minimal test stand-in
    writeSSEHeaders(reply as any, request as any);
    expect(reply.raw.headers?.["Content-Type"]).toBe("text/event-stream");
    expect(reply.raw.headers?.["Cache-Control"]).toBe("no-cache");
  });
});

describe("writeSSE — frame format", () => {
  test("formats event + data correctly with double-newline terminator", () => {
    const reply = makeFakeReply();
    // biome-ignore lint/suspicious/noExplicitAny: minimal test stand-in
    writeSSE(reply as any, "chunk", { delta: "hello" });
    expect(reply.raw.written).toEqual([
      `event: chunk\ndata: ${JSON.stringify({ delta: "hello" })}\n\n`,
    ]);
  });
});

describe("startHeartbeat", () => {
  test("writes a keep-alive comment frame at the configured interval", async () => {
    const reply = makeFakeReply();
    // biome-ignore lint/suspicious/noExplicitAny: minimal test stand-in
    const stop = startHeartbeat(reply as any, 30);
    await new Promise((r) => setTimeout(r, 100));
    stop();
    // After ~100ms with 30ms interval we expect at least 2 writes.
    expect(reply.raw.written.length).toBeGreaterThanOrEqual(2);
    for (const chunk of reply.raw.written) {
      expect(chunk).toBe(":keep-alive\n\n");
    }
  });

  test("stop function clears the interval — no further writes", async () => {
    const reply = makeFakeReply();
    // biome-ignore lint/suspicious/noExplicitAny: minimal test stand-in
    const stop = startHeartbeat(reply as any, 30);
    await new Promise((r) => setTimeout(r, 50));
    stop();
    const countAfterStop = reply.raw.written.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(reply.raw.written.length).toBe(countAfterStop);
  });

  test("writes are skipped if the underlying socket is destroyed", async () => {
    const reply = makeFakeReply();
    reply.raw.destroyed = true;
    // biome-ignore lint/suspicious/noExplicitAny: minimal test stand-in
    const stop = startHeartbeat(reply as any, 20);
    await new Promise((r) => setTimeout(r, 60));
    stop();
    expect(reply.raw.written.length).toBe(0);
  });
});
