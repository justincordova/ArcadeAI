import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
});

function Dashboard() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <p className="text-lg text-gray-400">Dashboard coming soon</p>
    </div>
  );
}
