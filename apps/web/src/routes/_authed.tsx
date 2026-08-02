import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { TopBar } from "../components/TopBar.js";
import { useTheme } from "../hooks/useTheme.js";
import { fetchMeOrNull } from "../lib/api/auth.js";
import { queryClient } from "../lib/query-client.js";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const me = await queryClient.ensureQueryData({
      queryKey: ["me"],
      queryFn: fetchMeOrNull,
    });
    if (!me) {
      // location.search in TanStack Router is the PARSED search-params
      // object, not a query string. Concatenating it with `+` triggers
      // String(obj) which throws "Cannot convert object to primitive
      // value". Use location.href, which is the full pathname + raw
      // search string already serialized.
      throw redirect({
        to: "/sign-in",
        search: { next: location.href },
      });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  // Reconcile the DOM theme with the server preference once ["me"] resolves.
  useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "var(--layout-viewport-h)",
        background: "var(--color-bg)",
        color: "var(--color-text-primary)",
      }}
    >
      <TopBar />
      <main style={{ flex: 1 }} className="route-enter">
        <Outlet />
      </main>
    </div>
  );
}
