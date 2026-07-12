import { defineConfig } from "vitest/config";

// Dedicated test config rather than reusing vite.config.ts: the unit tests
// target pure modules (no DOM, no router), so we skip the React / TanStack
// Router / Tailwind plugins entirely and run in a plain node environment.
// Native tsconfig `paths` resolution (Vite 6+) resolves the `@/*` and
// `@arcadeai/shared` aliases the source files import through, replacing the
// vite-tsconfig-paths plugin.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
