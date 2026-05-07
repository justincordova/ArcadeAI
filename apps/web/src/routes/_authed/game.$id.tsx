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

function FullPageState({
  children,
  isError,
}: {
  children: React.ReactNode;
  isError?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 56px)",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 12,
        background: "var(--color-bg)",
      }}
    >
      {isError ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "rgba(244,63,94,0.08)",
              border: "1px solid rgba(244,63,94,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 6v4M10 14h.01"
                stroke="var(--color-danger)"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <circle
                cx="10"
                cy="10"
                r="8"
                stroke="var(--color-danger)"
                strokeWidth="1.5"
                opacity="0.5"
              />
            </svg>
          </div>
          <p style={{ fontSize: 14, color: "var(--color-danger)", fontWeight: 600 }}>{children}</p>
        </div>
      ) : (
        <>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: "2px solid var(--color-border)",
              borderTopColor: "var(--color-accent-violet)",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{children}</p>
        </>
      )}
    </div>
  );
}

function GamePage() {
  const { id } = Route.useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["game", id],
    queryFn: () => fetchGame(id),
  });

  if (isLoading) {
    return <FullPageState>Loading game...</FullPageState>;
  }

  if (isError || !data) {
    return <FullPageState isError>Game not found.</FullPageState>;
  }

  return (
    <Builder initialCode={data.currentCode} initialMessages={data.messages} gameId={data.id} />
  );
}
