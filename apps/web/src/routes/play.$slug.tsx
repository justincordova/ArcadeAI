// Public read-only player for a shared game. Any visitor can land here —
// no auth required to view; auth is required to remix (the button routes
// the user through /sign-in?next=/play/:slug?intent=remix).

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useEffect } from "react";
import { LogoFull } from "../components/Logo.js";
import { GameIframe } from "../components/builder/GameIframe.js";
import { useSession } from "../hooks/useSession.js";
import { fetchPublicGame, remixPublicGame } from "../lib/api/games.js";

interface PlaySearch {
  intent?: string;
}

export const Route = createFileRoute("/play/$slug")({
  validateSearch: (search: Record<string, unknown>): PlaySearch => ({
    intent: typeof search.intent === "string" ? search.intent : undefined,
  }),
  component: PlayPage,
});

function PlayPage() {
  const { slug } = Route.useParams();
  const { intent } = Route.useSearch();
  const navigate = useNavigate();
  const { data: me } = useSession();

  const {
    data: game,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["public-game", slug],
    queryFn: () => fetchPublicGame(slug),
    retry: false,
  });

  const remixMutation = useMutation({
    mutationFn: () => remixPublicGame(slug),
    onSuccess: (result) => {
      navigate({ to: "/game/$id", params: { id: result.id } });
    },
  });

  // Post-sign-in redirect: when arriving with ?intent=remix and an
  // authenticated session, fire the remix immediately. Once running, the
  // mutation resets navigation so this effect runs at most once per visit.
  useEffect(() => {
    if (
      intent === "remix" &&
      me &&
      !remixMutation.isPending &&
      !remixMutation.isSuccess &&
      !remixMutation.isError
    ) {
      remixMutation.mutate();
    }
  }, [intent, me, remixMutation]);

  function handleRemixClick() {
    if (!me) {
      // Visitor not signed in — route through sign-in with intent so we
      // pick up where they left off after OAuth. useSession (via
      // fetchMeOrNull) yields null for unauthenticated visitors.
      navigate({
        to: "/sign-in",
        search: { next: `/play/${slug}?intent=remix` },
      });
      return;
    }
    remixMutation.mutate();
  }

  if (isLoading) {
    return <PlayLoading />;
  }

  if (isError || !game) {
    return <CenteredMessage isError>This game is private or no longer exists.</CenteredMessage>;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text-primary)",
      }}
    >
      {/* Top bar — minimal, no auth chrome */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 56,
          padding: "0 24px",
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <Link to="/" style={{ textDecoration: "none" }} aria-label="ArcadeAI home">
          <LogoFull />
        </Link>
        <button
          type="button"
          onClick={handleRemixClick}
          disabled={remixMutation.isPending}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 18px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            border: "none",
            background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)",
            color: "#fff",
            cursor: remixMutation.isPending ? "wait" : "pointer",
            opacity: remixMutation.isPending ? 0.7 : 1,
            transition: "opacity 0.15s",
            boxShadow: "0 2px 12px rgba(124,58,237,0.3)",
          }}
        >
          <Sparkles size={13} strokeWidth={1.8} />
          {remixMutation.isPending ? "Remixing…" : "Remix this"}
        </button>
      </header>

      {/* Main: iframe + footer */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <GameIframe code={game.currentCode} gameId={null} />
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            borderTop: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            flexShrink: 0,
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-text-primary)",
                marginBottom: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {game.title}
            </p>
            <p
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                lineHeight: 1.45,
              }}
              title={`by ${game.ownerDisplayName} · "${game.originalPrompt}"`}
            >
              by {game.ownerDisplayName} · "{game.originalPrompt}"
            </p>
          </div>
          {remixMutation.isError && (
            <p style={{ fontSize: 12, color: "var(--color-danger)" }}>
              {(remixMutation.error as Error).message}
            </p>
          )}
        </footer>
      </main>
    </div>
  );
}

function PlayLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: 14,
        background: "var(--color-bg)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "2px solid rgba(124,58,237,0.18)",
          borderTopColor: "rgba(124,58,237,0.85)",
          animation: "play-spin 0.8s linear infinite",
        }}
      />
      <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading game…</p>
      <style>{"@keyframes play-spin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}

function CenteredMessage({
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
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: 12,
        background: "var(--color-bg)",
        color: isError ? "var(--color-danger)" : "var(--color-text-secondary)",
        fontSize: 14,
      }}
    >
      <Link
        to="/"
        style={{
          color: "var(--color-text-muted)",
          fontSize: 12,
          textDecoration: "none",
          marginBottom: 16,
        }}
      >
        ← ArcadeAI
      </Link>
      {children}
    </div>
  );
}
