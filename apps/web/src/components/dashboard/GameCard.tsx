import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { GAMES_QUERY_KEY, type GameSummary, deleteGame, patchGame } from "../../lib/api/games.js";
import { toast } from "../ui/sonner.js";

interface GameCardProps {
  game: GameSummary;
  view: "grid" | "list";
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return rtf.format(-Math.floor(diff / 60_000), "minute");
  if (diff < 86_400_000) return rtf.format(-Math.floor(diff / 3_600_000), "hour");
  return rtf.format(-Math.floor(diff / 86_400_000), "day");
}

export function GameCard({ game, view }: GameCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(game.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hovered, setHovered] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

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

  function commitRename() {
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (trimmed && trimmed !== game.title) {
      renameMutation.mutate(trimmed);
    } else {
      setRenameValue(game.title);
    }
  }

  function handleCardClick() {
    if (renaming || menuOpen) return;
    navigate({ to: "/game/$id", params: { id: game.id } });
  }

  const kebab = (
    <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
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
                  setRenaming(true);
                },
              },
              {
                label: "Delete",
                danger: true,
                onClick: () => {
                  setMenuOpen(false);
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

  const deleteConfirm = confirmDelete && (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          margin: "0 16px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ padding: "20px 20px 0" }}>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--color-text-primary)",
              marginBottom: 6,
            }}
          >
            Delete this game?
          </h2>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>
            This action cannot be undone.
          </p>
          {deleteMutation.isError && (
            <p style={{ fontSize: 12, color: "var(--color-danger)", marginBottom: 12 }}>
              Failed to delete. Please try again.
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, padding: "0 20px 20px" }}>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            style={{
              flex: 1,
              padding: "9px 16px",
              borderRadius: 9,
              border: "1px solid var(--color-border)",
              background: "transparent",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            style={{
              flex: 1,
              padding: "9px 16px",
              borderRadius: 9,
              border: "none",
              background: "linear-gradient(135deg, #b91c1c 0%, #f43f5e 100%)",
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              cursor: deleteMutation.isPending ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: deleteMutation.isPending ? 0.6 : 1,
            }}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
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
            border: `1px solid ${hovered ? "rgba(124,58,237,0.25)" : "var(--color-border)"}`,
            background: hovered ? "var(--color-surface)" : "transparent",
            transition: "all 0.15s",
            position: "relative",
          }}
          onMouseEnter={() => setHovered(true)}
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
              {game.thumbnail ? (
                <img
                  src={game.thumbnail}
                  alt={game.title}
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
                      "linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(6,182,212,0.06) 100%)",
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
                        <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.35" />
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
              {renaming ? (
                <input
                  ref={inputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      setRenameValue(game.title);
                      setRenaming(false);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "100%",
                    background: "var(--color-surface-overlay)",
                    border: "1px solid rgba(124,58,237,0.4)",
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
          border: `1px solid ${hovered ? "rgba(124,58,237,0.3)" : "var(--color-border)"}`,
          background: "var(--color-surface)",
          transition: "all 0.2s",
          overflow: "hidden",
        }}
        onMouseEnter={() => setHovered(true)}
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
            {game.thumbnail ? (
              <img
                src={game.thumbnail}
                alt={game.title}
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
                    "linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(6,182,212,0.06) 100%)",
                }}
              >
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <defs>
                    <linearGradient id={`card-grad-${game.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.4" />
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
                    "linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(6,182,212,0.08) 100%)",
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
        {renaming && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 12px" }}>
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setRenameValue(game.title);
                  setRenaming(false);
                }
              }}
              style={{
                width: "100%",
                borderRadius: 6,
                border: "1px solid rgba(124,58,237,0.4)",
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

function PublicBadge() {
  return (
    <span
      title="This game is publicly shareable"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 7px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--color-success)",
        background: "rgba(9,9,15,0.75)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(34,211,160,0.4)",
      }}
    >
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M1.5 6h9M6 1.5c1.5 1.5 2.4 3 2.4 4.5S7.5 9 6 10.5C4.5 9 3.6 7.5 3.6 6S4.5 3 6 1.5z"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
      Public
    </span>
  );
}
