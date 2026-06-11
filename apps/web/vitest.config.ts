import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Dedicated test config rather than reusing vite.config.ts: the unit tests
// target pure modules (no DOM, no router), so we skip the React / TanStack
// Router / Tailwind plugins entirely and run in a plain node environment.
// tsconfigPaths resolves the `@/*` and `@arcadeai/shared` aliases the source
// files import through.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
