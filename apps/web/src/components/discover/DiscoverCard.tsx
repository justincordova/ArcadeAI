// One game tile on the discover gallery. Layout:
//
//   ┌────────────────────────┐
//   │ [thumbnail or generic] │  <- 16:10 with a hover scrim that
//   │              ▶ Play    │     reveals "Play" on the right and a
//   │ ♥ 12  ▷ 84             │     stats strip on the left
//   ├────────────────────────┤
//   │ Title goes here       │
//   │ by alice · "prompt"   │
//   └────────────────────────┘
//
// The like button is optimistic — toggling fires the mutation and
// updates the in-memory cached infinite-query item. On error we roll
// back. Anonymous likers are routed through /sign-in with a `next`.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Heart, Play } from "lucide-react";
import { toast } from "@/components/ui/sonner.js";
import { type DiscoverGame, likeGame, publicThumbnailUrl, unlikeGame } from "@/lib/api/games.js";

interface DiscoverCardProps {
  game: DiscoverGame;
  hovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  isAuthed: boolean;
}

export function DiscoverCard({ game, hovered, onHoverChange, isAuthed }: DiscoverCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const likeMutation = useMutation({
    mutationFn: () => (game.liked ? unlikeGame(game.slug) : likeGame(game.slug)),
    onMutate: async () => {
      // Optimistic toggle. We patch every page in every cached
      // ['discover', sort, genre] list — discoverable across sort changes.
      await queryClient.cancelQueries({ queryKey: ["discover"] });
      const snapshot = queryClient.getQueriesData({ queryKey: ["discover"] });
      queryClient.setQueriesData(
        { queryKey: ["discover"] },
        (
          old:
            | {
                pages: Array<{ items: DiscoverGame[]; nextOffset: number | null }>;
                pageParams: unknown[];
              }
            | undefined
        ) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              items: p.items.map((it) =>
                it.id === game.id
                  ? {
                      ...it,
                      liked: !game.liked,
                      likeCount: game.liked ? Math.max(0, it.likeCount - 1) : it.likeCount + 1,
                    }
                  : it
              ),
            })),
          };
        }
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      // Roll back to whatever each cache key held before. We replay the
      // snapshot list rather than calling invalidate so an in-flight
      // user can keep scrolling without a flash.
      if (ctx?.snapshot) {
        for (const [key, value] of ctx.snapshot) {
          queryClient.setQueryData(key, value);
        }
      }
      // The optimistic heart already reverted; surface why so it doesn't read
      // as a misclick.
      toast.error("Couldn't update like");
    },
    onSettled: () => {
      // Sync the public-play-page query for this slug so a navigation
      // to /play/:slug after liking from discover doesn't briefly show
      // stale like state.
      queryClient.invalidateQueries({ queryKey: ["public-game", game.slug] });
      // Reconcile the discover grid with the server's authoritative count.
      // The optimistic patch above is a +/-1 guess off the snapshot; the
      // mutation's RETURNING value is the source of truth (e.g. when the same
      // user already liked from another device, the idempotent path returns an
      // unchanged count). Without this the grid count never self-corrects.
      // Mirrors the play page's onSettled, which already invalidates discover.
      queryClient.invalidateQueries({ queryKey: ["discover"] });
    },
  });

  function handleLikeClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthed) {
      navigate({ to: "/sign-in", search: { next: "/discover" } });
      return;
    }
    // Guard against double-fire: two clicks before the optimistic re-render
    // both read the stale `game.liked` and would send two identical POSTs.
    // Mirrors the play page's `disabled={likeMutation.isPending}`.
    if (likeMutation.isPending) return;
    likeMutation.mutate();
  }

  return (
    <Link
      to="/play/$slug"
      params={{ slug: game.slug }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        border: hovered ? "1px solid rgba(255,62,165,0.4)" : "1px solid var(--color-border)",
        background: "var(--color-surface)",
        overflow: "hidden",
        textDecoration: "none",
        transition: "all 0.18s",
        boxShadow: hovered
          ? "0 8px 32px rgba(255,62,165,0.12), 0 1px 0 rgba(255,62,165,0.15)"
          : "0 1px 0 rgba(255,255,255,0.02)",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
      }}
    >
      {/* Thumbnail area */}
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 10",
          background:
            "linear-gradient(135deg, rgba(255,62,165,0.06) 0%, rgba(76,223,232,0.06) 100%)",
          overflow: "hidden",
        }}
      >
        {game.hasThumbnail ? (
          <img
            src={publicThumbnailUrl(game.slug)}
            alt={game.title}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <ThumbPlaceholder id={game.id} />
        )}

        {/* Hover scrim */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, transparent 50%, rgba(8,7,13,0.85) 100%)",
            opacity: hovered ? 1 : 0.6,
            transition: "opacity 0.18s",
            pointerEvents: "none",
          }}
        />

        {/* Stats — bottom-left */}
        <div
          style={{
            position: "absolute",
            left: 10,
            bottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "rgba(236,233,245,0.92)",
            fontSize: 11,
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontWeight: 500,
            letterSpacing: "0.02em",
            textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          }}
        >
          <button
            type="button"
            onClick={handleLikeClick}
            disabled={likeMutation.isPending}
            aria-label={game.liked ? "Unlike" : "Like"}
            aria-pressed={game.liked}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 7px",
              borderRadius: 9999,
              border: "1px solid rgba(255,255,255,0.1)",
              background: game.liked ? "rgba(255,62,165,0.18)" : "rgba(8,7,13,0.55)",
              backdropFilter: "blur(6px)",
              color: "inherit",
              fontFamily: "inherit",
              fontSize: 11,
              cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            <Heart
              size={11}
              strokeWidth={2.2}
              fill={game.liked ? "var(--color-accent-primary)" : "none"}
              style={{ color: game.liked ? "var(--color-accent-primary)" : "currentColor" }}
            />
            {game.likeCount}
          </button>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              opacity: 0.8,
            }}
          >
            <Play size={10} strokeWidth={2.2} fill="currentColor" />
            {game.playCount}
          </span>
        </div>

        {/* Play affordance — bottom-right, fades in on hover */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px 5px 8px",
            borderRadius: 9999,
            background: "rgba(255,62,165,0.92)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            letterSpacing: "0.04em",
            boxShadow: "0 6px 20px rgba(255,62,165,0.35)",
            opacity: hovered ? 1 : 0,
            transform: hovered ? "translateY(0)" : "translateY(4px)",
            transition: "all 0.18s",
          }}
        >
          <Play size={11} strokeWidth={2.2} fill="currentColor" />
          PLAY
        </div>

        {/* Genre tag — top-left, very subtle */}
        {game.genre && (
          <span
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              padding: "2px 8px",
              borderRadius: 9999,
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontFamily: "IBM Plex Mono, ui-monospace, monospace",
              fontWeight: 600,
              color: "rgba(236,233,245,0.78)",
              background: "rgba(8,7,13,0.55)",
              backdropFilter: "blur(6px)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {game.genre}
          </span>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "12px 14px 14px" }}>
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            margin: 0,
          }}
        >
          {game.title}
        </p>
        <p
          style={{
            marginTop: 4,
            fontSize: 11,
            color: "var(--color-text-muted)",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            lineHeight: 1.45,
          }}
          title={`by ${game.ownerDisplayName} · "${game.originalPrompt}"`}
        >
          by {game.ownerDisplayName} ·{" "}
          <span style={{ color: "var(--color-text-secondary)" }}>"{game.originalPrompt}"</span>
        </p>
      </div>
    </Link>
  );
}

function ThumbPlaceholder({ id }: { id: string }) {
  // Procedural CRT placeholder — same hue family as the brand. Two stacked
  // gradients give it depth without an external asset.
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundImage:
          "radial-gradient(ellipse at 30% 20%, rgba(255,62,165,0.18) 0%, transparent 55%), radial-gradient(ellipse at 80% 80%, rgba(76,223,232,0.16) 0%, transparent 55%)",
      }}
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          opacity: 0.55,
        }}
      >
        <defs>
          <linearGradient id={`thumb-grad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff7bc5" />
            <stop offset="100%" stopColor="#4cdfe8" />
          </linearGradient>
        </defs>
        <path
          d="M6 14 C6 7 10 4 16 4 C22 4 26 7 26 14"
          stroke={`url(#thumb-grad-${id})`}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M6 14 L5 26 C5 27.1 5.9 28 7 28 L25 28 C26.1 28 27 27.1 27 26 L26 14"
          stroke={`url(#thumb-grad-${id})`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect
          x="10"
          y="12"
          width="12"
          height="8"
          rx="1.5"
          stroke={`url(#thumb-grad-${id})`}
          strokeWidth="1.5"
          fill="none"
        />
      </svg>
    </div>
  );
}
