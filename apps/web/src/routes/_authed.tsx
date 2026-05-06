import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { TopBar } from "../components/TopBar.js";
import { fetchMe } from "../lib/auth.js";
import { queryClient } from "../lib/query-client.js";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const me = await queryClient.ensureQueryData({
      queryKey: ["me"],
      queryFn: fetchMe,
    });
    if (!me) {
      throw redirect({
        to: "/sign-in",
        search: { next: location.pathname + location.search },
      });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-white">
      <TopBar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
