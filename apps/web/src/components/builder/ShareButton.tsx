// Publish/unpublish toggle for a saved game. Reads the current publish
// state from the cached `["game", gameId]` query so the button reflects
// whatever the most recent fetch returned. On publish, copies the public
// URL to the clipboard; on unpublish, the slug is retained server-side so
// republishing produces the same URL.

import { type GameDetail, fetchGame, publishGame, unpublishGame } from "@/lib/api/games.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Share2 } from "lucide-react";
import { toast } from "../ui/sonner.js";

export function ShareButton({ gameId }: { gameId: string }) {
  const queryClient = useQueryClient();
  // Subscribe to the game query so the button re-renders when publish state
  // changes. A one-shot getQueryData read would not react to the refetch
  // that invalidateQueries triggers after publish/unpublish, leaving the
  // button showing stale state until some unrelated re-render.
  const { data: game, isError } = useQuery<GameDetail>({
    queryKey: ["game", gameId],
    queryFn: () => fetchGame(gameId),
  });
  const isPublic = Boolean(game?.isPublic);
  const slug = game?.publicSlug ?? null;

  const publishMutation = useMutation({
    mutationFn: () => publishGame(gameId),
    onSuccess: (result) => {
      const url = `${window.location.origin}/play/${result.slug}`;
      navigator.clipboard
        ?.writeText(url)
        .then(() => toast.success("Public link copied to clipboard"))
        .catch(() => toast.success("Game published", { description: url }));
      queryClient.invalidateQueries({ queryKey: ["game", gameId] });
    },
    onError: () => {
      toast.error("Failed to publish game");
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: () => unpublishGame(gameId),
    onSuccess: () => {
      toast.success("Game is now private");
      queryClient.invalidateQueries({ queryKey: ["game", gameId] });
    },
    onError: () => {
      toast.error("Failed to unpublish game");
    },
  });

  function handleClick() {
    if (isPublic) {
      unpublishMutation.mutate();
    } else {
      publishMutation.mutate();
    }
  }

  function handleCopy() {
    if (!slug) return;
    const url = `${window.location.origin}/play/${slug}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success("Public link copied"))
      .catch(() => toast.error("Could not copy to clipboard"));
  }

  const busy = publishMutation.isPending || unpublishMutation.isPending;
  // If the game query errored (cold cache + failed fetch), `game` is undefined
  // and isPublic/slug would default to the private state — which could be
  // wrong for an actually-published game. Don't let the user toggle against an
  // unknown state; disable until the read recovers.
  const disabled = busy || isError;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {isPublic && slug && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy public link"
          title={`Copy ${window.location.origin}/play/${slug}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--color-text-secondary)",
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          /play/{slug}
        </button>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={isError ? "Publish state unavailable — couldn't load the game" : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          borderRadius: 7,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "inherit",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          border: isPublic ? "1px solid rgba(34,211,160,0.4)" : "1px solid var(--color-border)",
          background: isPublic ? "rgba(34,211,160,0.08)" : "transparent",
          color: isPublic ? "var(--color-success)" : "var(--color-text-secondary)",
          cursor: disabled ? (busy ? "wait" : "not-allowed") : "pointer",
          opacity: disabled ? 0.6 : 1,
          transition: "all 0.15s",
        }}
      >
        {isPublic ? <Check size={11} strokeWidth={2.2} /> : <Share2 size={11} strokeWidth={2} />}
        {isPublic ? "Public" : "Share"}
      </button>
    </div>
  );
}
