import { ErrorBoundary } from "@/components/ErrorBoundary.js";
import { RouteError } from "@/components/RouteError.js";
import { Outlet, createRootRoute, useRouter } from "@tanstack/react-router";

function RootLayout() {
  const router = useRouter();
  // Reset on route change so navigating away from an error page actually
  // recovers — without this the boundary stays in "errored" state until the
  // user clicks Try again.
  return (
    <ErrorBoundary
      fallback={(p) => <RouteError {...p} />}
      onReset={() => router.invalidate()}
      resetKeys={[router.state.location.pathname]}
    >
      <Outlet />
    </ErrorBoundary>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
