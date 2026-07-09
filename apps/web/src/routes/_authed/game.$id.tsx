import { Builder } from "@/components/builder/Builder.js";
import { fetchGame } from "@/lib/api/games.js";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";

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
        height: "calc(100vh - var(--layout-topbar-h))",
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
            <AlertCircle size={20} strokeWidth={1.8} style={{ color: "var(--color-danger)" }} />
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
              borderTopColor: "var(--color-accent-primary)",
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
    // Poll while a generation is in progress server-side (user navigated
    // away mid-stream and came back). Stops once current_code lands.
    // 1500ms balances perceived freshness against load: a 30s generation
    // is ~20 polls, trivial. Cleared automatically once the predicate
    // returns false.
    refetchInterval: (query) =>
      query.state.data?.inProgress && !query.state.data?.currentCode ? 1500 : false,
  });

  if (isLoading) {
    return <FullPageState>Loading game...</FullPageState>;
  }

  if (isError || !data) {
    return <FullPageState isError>Game not found.</FullPageState>;
  }

  return (
    // Key on the game id so navigating directly between games (prefetched
    // dashboard cards, back/forward) remounts a fresh Builder. Without it,
    // TanStack Router keeps GamePage mounted across :id changes and the
    // Builder's per-game state (repairedCode / finalCode / streamingCode,
    // RepairController refs) bleeds over — the preview would render the
    // previous game's code under the new game's chat until its data lands.
    <Builder
      key={data.id}
      initialCode={data.currentCode}
      initialMessages={data.messages}
      gameId={data.id}
      externalStreaming={data.inProgress && !data.currentCode}
      canUndo={data.canUndo}
    />
  );
}
