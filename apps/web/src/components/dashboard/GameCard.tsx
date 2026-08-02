import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useInlineRename } from "@/hooks/useInlineRename.js";
import { useOutsideClick } from "@/hooks/useOutsideClick.js";
import {
  deleteGame,
  fetchGame,
  GAMES_QUERY_KEY,
  type GameSummary,
  gameThumbnailUrl,
  patchGame,
} from "@/lib/api/games.js";
import { formatRelative } from "@/lib/format-time.js";
import { toast } from "../ui/sonner.js";
import { DeleteGameDialog } from "./DeleteGameDialog.js";
import { PublicBadge } from "./PublicBadge.js";

interface GameCardProps {
  game: GameSummary;
  view: "grid" | "list";
}

export function GameCard({ game, view }: GameCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hovered, setHovered] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);

  useOutsideClick(
    menuRef,
    menuOpen,
    useCallback(() => setMenuOpen(false), []),
    kebabRef
  );

  const renameMutation = useMutation({
    mutationFn: (title: string) => patchGame(game.id, { title }),
    onMutate: async (title) => {
      await queryClient.cancelQueries({ queryKey: GAMES_QUERY_KEY });
      const prev = queryClient.getQueryData<GameSummary[]>(GAMES_QUERY_KEY);
      queryClient.setQueryData<GameSummary[]>(GAMES_QUERY_KEY, (old) =>
        old?.map((g) => (g.id === game.id ? { ...g, title } : g))
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(GAMES_QUERY_KEY, ctx.prev);
      toast.error("Failed to rename game");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGame(game.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY });
      setConfirmDelete(false);
      toast.success("Game deleted");
    },
    onError: () => {
      toast.error("Failed to delete game");
    },
  });

  const rename = useInlineRename({
    value: game.title,
    onCommit: (title) => renameMutation.mutate(title),
  });

  function handleCardClick() {
    if (rename.renaming || menuOpen) return;
    navigate({ to: "/game/$id", params: { id: game.id } });
  }

  // Prefetch on hover (#15) so navigation feels instant. The query has no
  // staleTime override, so a navigation right after the prefetch will hit
  // the cache; if the game has been refreshed elsewhere, the next visit
  // refetches as normal.
  function handlePrefetch() {
    setHovered(true);
    queryClient.prefetchQuery({ queryKey: ["game", game.id], queryFn: () => fetchGame(game.id) });
  }

  const kebab = (
    <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={kebabRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        // In grid view the kebab is hover-revealed, which leaves it
        // invisible-but-focusable for keyboard users. Treating focus like
        // hover reveals it when tabbed to.
        onFocus={() => setHovered(true)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        style={{
          display: "flex",
          width: 28,
          height: 28,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          background: view === "list" ? "transparent" : "rgba(9,9,15,0.75)",
          backdropFilter: view === "list" ? undefined : "blur(8px)",
          border:
            view === "list" ? "1px solid var(--color-border)" : "1px solid rgba(255,255,255,0.08)",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          opacity: view === "list" ? 1 : hovered || menuOpen ? 1 : 0,
          transition: "opacity 0.15s",
        }}
        aria-label="Game options"
      >
        ···
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Game options"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            width: 140,

            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            zIndex: 50,
          }}
        >
          {(
            [
              {
                label: "Rename",
                danger: false,
                onClick: () => {
                  setMenuOpen(false);
                  rename.start();
                },
              },
              {
                label: "Delete",
                danger: true,
                onClick: () => {
                  setMenuOpen(false);
                  // Clear any error left by a previous failed attempt.
                  // isError is never reset otherwise, so reopening the dialog
                  // rendered "Failed to delete" before the user did anything.
                  deleteMutation.reset();
                  setConfirmDelete(true);
                },
              },
            ] as const
          ).map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                padding: "9px 12px",
                fontSize: 12,
                color: item.danger ? "var(--color-danger)" : "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                transition: "all 0.12s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = item.danger
                  ? "rgba(244,63,94,0.08)"
                  : "var(--color-surface-raised)";
                if (!item.danger)
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                (e.currentTarget as HTMLButtonElement).style.color = item.danger
                  ? "var(--color-danger)"
                  : "var(--color-text-secondary)";
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const deleteConfirm = (
    <DeleteGameDialog
      open={confirmDelete}
      onOpenChange={setConfirmDelete}
      onConfirm={() => deleteMutation.mutate()}
      isDeleting={deleteMutation.isPending}
      hasError={deleteMutation.isError}
    />
  );

  // ── List view ──
  if (view === "list") {
    return (
      <>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderRadius: 10,
            border: `1px solid ${hovered ? "rgba(255,62,165,0.25)" : "var(--color-border)"}`,
            background: hovered ? "var(--color-surface)" : "transparent",
            transition: "all 0.15s",
            position: "relative",
          }}
          onMouseEnter={handlePrefetch}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            onClick={handleCardClick}
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              gap: 14,
              padding: "10px 14px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              minWidth: 0,
            }}
          >
            {/* Thumbnail */}
            <div
              style={{
                width: 64,
                height: 40,
                borderRadius: 6,
                overflow: "hidden",
                background: "var(--color-surface-raised)",
                flexShrink: 0,
              }}
            >
              {game.hasThumbnail ? (
                <img
                  src={gameThumbnailUrl(game.id)}
                  alt={game.title}
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background:
                      "linear-gradient(135deg, rgba(255,62,165,0.06) 0%, rgba(76,223,232,0.06) 100%)",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <defs>
                      <linearGradient
                        id={`list-grad-${game.id}`}
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="100%"
                      >
                        <stop
                          offset="0%"
                          stopColor="var(--color-accent-primary)"
                          stopOpacity="0.35"
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--color-accent-secondary)"
                          stopOpacity="0.35"
                        />
                      </linearGradient>
                    </defs>
                    <path
                      d="M6 14 C6 7 10 4 16 4 C22 4 26 7 26 14"
                      stroke={`url(#list-grad-${game.id})`}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      fill="none"
                    />
                    <path
                      d="M6 14 L5 26 C5 27.1 5.9 28 7 28 L25 28 C26.1 28 27 27.1 27 26 L26 14"
                      stroke={`url(#list-grad-${game.id})`}
                      strokeWidth="2.5"
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
                      stroke={`url(#list-grad-${game.id})`}
                      strokeWidth="1.8"
                      fill="none"
                    />
                  </svg>
                </div>
              )}
            </div>

            {/* Title + meta */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {rename.renaming ? (
                <input
                  ref={rename.inputRef}
                  value={rename.draft}
                  onChange={(e) => rename.setDraft(e.target.value)}
                  onBlur={rename.commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename.commit();
                    if (e.key === "Escape") rename.cancel();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "100%",
                    background: "var(--color-surface-overlay)",
                    border: "1px solid rgba(255,62,165,0.4)",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: 13,
                    color: "var(--color-text-primary)",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {game.title}
                  </p>
                  {game.isPublic && <PublicBadge />}
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                Edited {formatRelative(game.updatedAt)}
              </p>
            </div>
          </button>

          {/* Kebab — outside the clickable button */}
          <div style={{ paddingRight: 10, flexShrink: 0 }}>{kebab}</div>
        </div>
        {deleteConfirm}
      </>
    );
  }

  // ── Grid view ──
  return (
    <>
      <div
        style={{
          position: "relative",
          borderRadius: 12,
          border: `1px solid ${hovered ? "rgba(255,62,165,0.3)" : "var(--color-border)"}`,
          background: "var(--color-surface)",
          transition: "all 0.2s",
          overflow: "hidden",
        }}
        onMouseEnter={handlePrefetch}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          type="button"
          style={{
            display: "block",
            width: "100%",
            cursor: "pointer",
            textAlign: "left",
            background: "transparent",
            border: "none",
            padding: 0,
          }}
          onClick={handleCardClick}
        >
          {/* Thumbnail */}
          <div
            style={{
              aspectRatio: "16/9",
              width: "100%",
              overflow: "hidden",
              background: "var(--color-bg)",
              position: "relative",
            }}
          >
            {game.hasThumbnail ? (
              <img
                src={gameThumbnailUrl(game.id)}
                alt={game.title}
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background:
                    "linear-gradient(135deg, rgba(255,62,165,0.06) 0%, rgba(76,223,232,0.06) 100%)",
                }}
              >
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <defs>
                    <linearGradient id={`card-grad-${game.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="var(--color-accent-primary)" stopOpacity="0.4" />
                      <stop
                        offset="100%"
                        stopColor="var(--color-accent-secondary)"
                        stopOpacity="0.4"
                      />
                    </linearGradient>
                  </defs>
                  <path
                    d="M6 14 C6 7 10 4 16 4 C22 4 26 7 26 14"
                    stroke={`url(#card-grad-${game.id})`}
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    d="M6 14 L5 26 C5 27.1 5.9 28 7 28 L25 28 C26.1 28 27 27.1 27 26 L26 14"
                    stroke={`url(#card-grad-${game.id})`}
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
                    stroke={`url(#card-grad-${game.id})`}
                    strokeWidth="1.5"
                    fill="none"
                  />
                </svg>
              </div>
            )}
            {hovered && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(135deg, rgba(255,62,165,0.08) 0%, rgba(76,223,232,0.08) 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "rgba(9,9,15,0.7)",
                    backdropFilter: "blur(4px)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M3 7l4-4 4 4M7 3v8"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* Card footer */}
          <div style={{ padding: "10px 12px" }}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {game.title}
            </p>
            <p style={{ marginTop: 2, fontSize: 11, color: "var(--color-text-muted)" }}>
              Edited {formatRelative(game.updatedAt)}
            </p>
          </div>
        </button>

        {/* Inline rename */}
        {rename.renaming && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 12px" }}>
            <input
              ref={rename.inputRef}
              value={rename.draft}
              onChange={(e) => rename.setDraft(e.target.value)}
              onBlur={rename.commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename.commit();
                if (e.key === "Escape") rename.cancel();
              }}
              style={{
                width: "100%",
                borderRadius: 6,
                border: "1px solid rgba(255,62,165,0.4)",
                background: "var(--color-surface-overlay)",
                padding: "4px 8px",
                fontSize: 13,
                color: "var(--color-text-primary)",
                fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>
        )}

        {/* Kebab */}
        <div style={{ position: "absolute", right: 8, top: 8 }}>{kebab}</div>

        {/* Public badge — top-left so it doesn't conflict with the kebab */}
        {game.isPublic && (
          <div style={{ position: "absolute", left: 8, top: 8 }}>
            <PublicBadge />
          </div>
        )}
      </div>
      {deleteConfirm}
    </>
  );
}
