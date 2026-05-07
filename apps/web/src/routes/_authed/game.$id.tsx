import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Builder } from "../../components/builder/Builder.js";

const API = "http://localhost:3000";

interface GameData {
  id: string;
  title: string;
  currentCode: string;
  messages: Array<{ id: string; kind: string; content: string; createdAt: number }>;
}

async function fetchGame(id: string): Promise<GameData> {
  const res = await fetch(`${API}/api/games/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Game not found");
  return res.json() as Promise<GameData>;
}

export const Route = createFileRoute("/_authed/game/$id")({
  component: GamePage,
});

function GamePage() {
  const { id } = Route.useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["game", id],
    queryFn: () => fetchGame(id),
  });

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-53px)] items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-[calc(100vh-53px)] items-center justify-center text-red-400">
        Game not found.
      </div>
    );
  }

  return (
    <Builder initialCode={data.currentCode} initialMessages={data.messages} gameId={data.id} />
  );
}
