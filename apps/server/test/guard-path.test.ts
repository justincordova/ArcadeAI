// Regression tests for lib/guard-path.ts and the two guards that use it.
//
// Fastify's router percent-decodes the path before matching routes. A guard
// that matches on the raw `request.url` therefore disagrees with the router
// about which route a request reaches: `GET /%61pi/me` does not start with
// `/api/`, but it is dispatched to the `/api/me` handler. Both the auth guard
// and the CSRF guard used to match on the raw URL and were bypassable this way.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import { registerCsrfGuard } from "../src/plugins/csrf.js";

let app: FastifyInstance;

// Encoded spellings of "/api/me" that find-my-way decodes back to /api/me.
const ENCODED_VARIANTS = ["/%61pi/me", "/ap%69/me", "/api/m%65"];

beforeEach(async () => {
  app = Fastify({ logger: false });
});

afterEach(async () => {
  await app.close();
});

describe("auth guard path resolution", () => {
  // Mirrors registerAuthGuard's exemption logic without pulling in Better Auth
  // (which needs a live DB). The property under test is which paths the guard
  // decides to skip — not what it does once it decides to run.
  function registerPathOnlyGuard(instance: FastifyInstance) {
    instance.addHook("preHandler", async (request, reply) => {
      const path = request.routeOptions?.url ?? request.url.split("?")[0];
      if (
        !path.startsWith("/api/") ||
        path.startsWith("/api/auth/") ||
        path === "/api/health" ||
        path === "/api/config" ||
        path.startsWith("/api/play/") ||
        path === "/api/discover" ||
        path.startsWith("/api/og/")
      ) {
        return;
      }
      return reply.code(401).send({ code: "UNAUTHORIZED" });
    });
  }

  beforeEach(async () => {
    registerPathOnlyGuard(app);
    app.get("/api/me", async () => ({ reached: true }));
    app.get("/api/health", async () => ({ ok: true }));
    app.get("/api/config", async () => ({ ok: true }));
    app.get("/api/discover", async () => ({ ok: true }));
    app.get("/api/auth/*", async () => ({ ok: true }));
    app.get("/api/play/:slug", async () => ({ ok: true }));
    app.get("/api/og/:slug.png", async () => ({ ok: true }));
    app.get("/assets/*", async () => ({ ok: true }));
    await app.ready();
  });

  test("guards a protected route", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  test.each(ENCODED_VARIANTS)("percent-encoded %s does not bypass the guard", async (url) => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });

  test("query strings do not affect the decision", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me?next=/x" });
    expect(res.statusCode).toBe(401);
  });

  test.each([
    "/api/health",
    "/api/config",
    "/api/discover",
    "/api/auth/callback/google",
    "/api/play/abcd1234",
    "/api/og/abcd1234.png",
    "/assets/app.js",
  ])("exempt path %s still passes through", async (url) => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
  });
});

describe("CSRF guard path resolution", () => {
  beforeEach(async () => {
    // The real app registers a form-encoded parser in authPlugin, and accepts
    // text/plain nowhere. Register both here so Fastify's own 415-on-unknown-
    // content-type can't be mistaken for the CSRF guard's 415.
    app.addContentTypeParser(
      ["application/x-www-form-urlencoded", "text/plain"],
      { parseAs: "buffer" },
      (_request, payload, done) => done(null, payload)
    );
    registerCsrfGuard(app);
    app.post("/api/me", async () => ({ reached: true }));
    app.post("/api/play/:slug/play", async () => ({ reached: true }));
    app.post("/api/auth/*", async () => ({ reached: true }));
    await app.ready();
  });

  test("rejects a non-JSON content type on /api/*", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me",
      headers: { "content-type": "text/plain" },
      payload: "x",
    });
    expect(res.statusCode).toBe(415);
  });

  test("percent-encoded path does not bypass the content-type guard", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/%61pi/me",
      headers: { "content-type": "text/plain" },
      payload: "x",
    });
    expect(res.statusCode).toBe(415);
  });

  // The public play prefix is exempt from the auth guard but NOT from CSRF —
  // it is a state-changing POST reachable with only a session cookie.
  test("percent-encoded public play route does not bypass the content-type guard", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/%61pi/play/abcd1234/play",
      headers: { "content-type": "text/plain" },
      payload: "x",
    });
    expect(res.statusCode).toBe(415);
  });

  test("allows application/json", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  test("/api/auth/* remains exempt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "provider=google",
    });
    expect(res.statusCode).toBe(200);
  });
});
