import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "../../components/dashboard/EmptyState.js";
import { GameGrid } from "../../components/dashboard/GameGrid.js";
import { GAMES_QUERY_KEY, listGames } from "../../lib/api/games.js";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: GAMES_QUERY_KEY,
    queryFn: listGames,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <p className="font-mono text-sm text-gray-600">Loading…</p>
      </div>
    );
  }

  const games = data ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-mono text-xl font-semibold text-white">My Games</h1>
      </div>
      {games.length === 0 ? <EmptyState /> : <GameGrid games={games} />}
    </div>
  );
}
