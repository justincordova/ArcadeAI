// Integration tests for routes/health.ts — exercises the actual Fastify
// handler via app.inject(). No mocks: the routes have no DB / auth /
// upstream dependencies, so this is the easy case for the inject pattern.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "../src/routes/health.js";

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(healthRoutes);
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/health", () => {
  test("returns 200 with ok:true", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
  });
});

describe("GET /api/config", () => {
  test("returns boolean flags for required AI provider keys", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hasAnthropicKey: boolean; hasOpenAiKey: boolean };
    expect(typeof body.hasAnthropicKey).toBe("boolean");
    expect(typeof body.hasOpenAiKey).toBe("boolean");
  });

  test("hasAnthropicKey reflects ANTHROPIC_API_KEY presence", async () => {
    // Save / restore so we don't leak state into sibling tests
    const original = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = "sk-test";
      const res1 = await app.inject({ method: "GET", url: "/api/config" });
      expect((res1.json() as { hasAnthropicKey: boolean }).hasAnthropicKey).toBe(true);

      Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
      const res2 = await app.inject({ method: "GET", url: "/api/config" });
      expect((res2.json() as { hasAnthropicKey: boolean }).hasAnthropicKey).toBe(false);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
      } else {
        process.env.ANTHROPIC_API_KEY = original;
      }
    }
  });
});
