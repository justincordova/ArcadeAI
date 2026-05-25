// Public read-only player for a shared game. Any visitor can land here —
// no auth required to view; auth is required to remix (the button routes
// the user through /sign-in?next=/play/:slug?intent=remix).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Heart, Play, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { LogoFull } from "../components/Logo.js";
import { GameIframe } from "../components/builder/GameIframe.js";
import { useSession } from "../hooks/useSession.js";
import { API_BASE } from "../lib/api/client.js";
import {
  type PublicGame,
  fetchPublicGame,
  likeGame,
  recordPlay,
  remixPublicGame,
  unlikeGame,
} from "../lib/api/games.js";
import { setDocumentHead } from "../lib/document-head.js";

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
  const queryClient = useQueryClient();

  const {
    data: game,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["public-game", slug],
    queryFn: () => fetchPublicGame(slug),
    retry: false,
  });

  // Record one play per visit. The mutation is fire-and-forget on the
  // client; the server is idempotent in the sense that it never errors,
  // but we still bump play count once per slug per page mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate — fire once per slug change
  useEffect(() => {
    if (!game) return;
    recordPlay(slug);
  }, [slug, game?.id]);

  // Set <title>, <meta name="description">, og:* and twitter:* so unfurls
  // and tab titles are correct. og:image points at the API route which
  // serves the captured thumbnail (or a fallback PNG).
  useEffect(() => {
    if (!game) return;
    const ogImage = `${API_BASE}/api/og/${slug}.png`;
    const url = `${window.location.origin}/play/${slug}`;
    const description = `Play "${game.title}" by ${game.ownerDisplayName} — built on ArcadeAI from a single prompt.`;
    return setDocumentHead({
      title: `${game.title} · ArcadeAI`,
      description,
      ogTitle: game.title,
      ogDescription: description,
      ogImage,
      ogUrl: url,
    });
  }, [slug, game]);

  const remixMutation = useMutation({
    mutationFn: () => remixPublicGame(slug),
    onSuccess: (result) => {
      navigate({ to: "/game/$id", params: { id: result.id } });
    },
  });

  const likeMutation = useMutation({
    mutationFn: () => (game?.liked ? unlikeGame(slug) : likeGame(slug)),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["public-game", slug] });
      const prev = queryClient.getQueryData<PublicGame>(["public-game", slug]);
      if (prev) {
        queryClient.setQueryData<PublicGame>(["public-game", slug], {
          ...prev,
          liked: !prev.liked,
          likeCount: prev.liked ? Math.max(0, prev.likeCount - 1) : prev.likeCount + 1,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["public-game", slug], ctx.prev);
    },
    onSettled: () => {
      // Refresh discover lists too so the count there stays in sync.
      queryClient.invalidateQueries({ queryKey: ["discover"] });
    },
  });

  function handleLikeClick() {
    if (!me) {
      navigate({
        to: "/sign-in",
        search: { next: `/play/${slug}?intent=like` },
      });
      return;
    }
    likeMutation.mutate();
  }

  // Post-sign-in redirect: when arriving with ?intent=remix or ?intent=like
  // and an authenticated session, fire the corresponding action immediately —
  // exactly once. The previous guard relied on TanStack Query's mutation
  // status flags, but those change identity in ways that re-ran the effect
  // and could double-fire the mutation (especially if the user hit Back to
  // /play/:slug?intent=remix later, which would create a second remix). Use
  // a ref-based latch and clear the search param the first time we act so
  // any subsequent re-renders / navigations see no intent at all.
  const intentFiredRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate — mutations are stable enough; ref latch is the source of truth
  useEffect(() => {
    if (intentFiredRef.current) return;
    if (!intent || !me) return;
    if (intent === "remix") {
      intentFiredRef.current = true;
      navigate({ to: "/play/$slug", params: { slug }, search: {}, replace: true });
      remixMutation.mutate();
    } else if (intent === "like" && game && !game.liked) {
      intentFiredRef.current = true;
      navigate({ to: "/play/$slug", params: { slug }, search: {}, replace: true });
      likeMutation.mutate();
    }
  }, [intent, me, game?.id, game?.liked, navigate, slug]);

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
        // Fixed viewport height so the inner flex:1 chain has a real height
        // to resolve against. With minHeight, the iframe (height:100%) had
        // no resolved parent height and collapsed, cropping the canvas.
        height: "100vh",
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link
            to="/discover"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-text-secondary)",
              textDecoration: "none",
              padding: "8px 12px",
            }}
          >
            Discover
          </Link>
          <button
            type="button"
            onClick={handleLikeClick}
            disabled={likeMutation.isPending}
            aria-pressed={game.liked}
            aria-label={game.liked ? "Unlike" : "Like"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              border: game.liked
                ? "1px solid rgba(255,62,165,0.45)"
                : "1px solid var(--color-border)",
              background: game.liked ? "rgba(255,62,165,0.12)" : "var(--color-surface-raised)",
              color: game.liked ? "var(--color-accent-primary)" : "var(--color-text-secondary)",
              cursor: likeMutation.isPending ? "wait" : "pointer",
              opacity: likeMutation.isPending ? 0.6 : 1,
              transition: "all 0.15s",
            }}
          >
            <Heart size={13} strokeWidth={2} fill={game.liked ? "currentColor" : "none"} />
            {game.likeCount}
          </button>
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
              backgroundImage: "var(--gradient-brand)",
              color: "#fff",
              cursor: remixMutation.isPending ? "wait" : "pointer",
              opacity: remixMutation.isPending ? 0.7 : 1,
              transition: "opacity 0.15s",
              boxShadow: "0 2px 14px rgba(255,62,165,0.3)",
            }}
          >
            <Sparkles size={13} strokeWidth={1.8} />
            {remixMutation.isPending ? "Remixing…" : "Remix"}
          </button>
        </div>
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
          <GameIframe code={game.currentCode} gameId={null} autoFocus />
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
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 2,
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  margin: 0,
                  minWidth: 0,
                }}
              >
                {game.title}
              </p>
              {game.genre && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 9,
                    fontFamily: "IBM Plex Mono, ui-monospace, monospace",
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    padding: "1px 6px",
                    borderRadius: 9999,
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  {game.genre}
                </span>
              )}
            </div>
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 11,
              fontFamily: "IBM Plex Mono, ui-monospace, monospace",
              color: "var(--color-text-muted)",
              flexShrink: 0,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Play size={10} strokeWidth={2.2} fill="currentColor" />
              {game.playCount}
            </span>
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
          border: "2px solid rgba(255,62,165,0.18)",
          borderTopColor: "rgba(255,62,165,0.9)",
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
