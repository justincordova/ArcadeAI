import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, type ErrorComponentProps, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouteError } from "./components/RouteError.js";
import { RoutePending } from "./components/RoutePending.js";
import { Toaster } from "./components/ui/sonner.js";
import { queryClient } from "./lib/query-client.js";
import { routeTree } from "./routeTree.gen.js";
import "./styles/index.css";

const router = createRouter({
  routeTree,
  // App-wide fallbacks so slow loaders show a spinner (not a blank/stale
  // screen) and loader/render errors get the branded recovery UI instead of
  // TanStack's default. defaultPendingMs delays the spinner slightly so fast
  // navigations don't flash it. RouteError takes { error, reset }, which the
  // router's error-component props satisfy.
  defaultPendingComponent: RoutePending,
  defaultErrorComponent: ({ error, reset }: ErrorComponentProps) => (
    <RouteError error={error} reset={reset} />
  ),
  defaultPendingMs: 200,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>
);
