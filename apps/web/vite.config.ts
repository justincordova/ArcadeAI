import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    // autoCodeSplitting splits each route's component into its own lazy chunk
    // so the public, most-shared `/play/:slug` page no longer ships the
    // builder/discover/pricing code on first paint. Must run before react().
    // Exclude colocated unit tests from route generation — a `*.test.ts` next
    // to a route file is a test, not a route, and would otherwise emit a
    // "does not export a Route" warning on every build.
    TanStackRouterVite({
      autoCodeSplitting: true,
      routeFileIgnorePattern: ".*\\.test\\.tsx?$",
    }),
    react(),
    tsconfigPaths(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Split the rarely-changing TanStack vendor into its own chunk so it
        // stays cached across deploys (app code changes far more often than the
        // framework version). Route components are already split via
        // autoCodeSplitting above; this just stabilizes a large shared vendor.
        // React itself is left in the core chunk — React 19's jsx-runtime entry
        // points make a dedicated react chunk resolve empty.
        manualChunks: {
          tanstack: ["@tanstack/react-query", "@tanstack/react-router"],
        },
      },
    },
  },
});
