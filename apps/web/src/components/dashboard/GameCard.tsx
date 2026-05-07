import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { GAMES_QUERY_KEY, type GameSummary, deleteGame, patchGame } from "../../lib/api/games.js";

interface GameCardProps {
  game: GameSummary;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return rtf.format(-Math.floor(diff / 60_000), "minute");
  if (diff < 86_400_000) return rtf.format(-Math.floor(diff / 3_600_000), "hour");
  return rtf.format(-Math.floor(diff / 86_400_000), "day");
}

export function GameCard({ game }: GameCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(game.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  return (
    <div className="group relative overflow-hidden rounded-xl border border-gray-800 bg-gray-900 transition-all hover:border-gray-600">
      {/* Clickable card area */}
      <button
        type="button"
        className="block w-full cursor-pointer text-left"
        onClick={handleCardClick}
      >
        {/* Thumbnail */}
        <div className="aspect-video w-full overflow-hidden bg-gray-950">
          {game.thumbnail ? (
            <img src={game.thumbnail} alt={game.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-3xl">🕹</span>
            </div>
          )}
        </div>

        {/* Card footer */}
        <div className="px-3 py-2">
          <p className="truncate font-mono text-sm text-white">{game.title}</p>
          <p className="mt-0.5 text-xs text-gray-500">Edited {formatRelative(game.updatedAt)}</p>
        </div>
      </button>

      {/* Inline rename input (overlays footer) */}
      {renaming && (
        <div className="absolute bottom-0 left-0 right-0 px-3 py-2">
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
            className="w-full rounded bg-gray-800 px-1 py-0.5 font-mono text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      {/* Kebab — hover-revealed */}
      <div ref={menuRef} className="absolute right-2 top-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900/80 text-gray-400 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:text-white"
          aria-label="Game options"
        >
          ⋯
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-36 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setRenaming(true);
              }}
              className="flex w-full items-center px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setConfirmDelete(true);
              }}
              className="flex w-full items-center px-3 py-2 text-sm text-red-400 hover:bg-gray-800"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Delete confirm dialog (portal-style fixed overlay) */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h2 className="mb-1 font-mono text-base font-semibold text-white">Delete this game?</h2>
            <p className="mb-6 text-sm text-gray-400">This can't be undone.</p>
            {deleteMutation.isError && (
              <p className="mb-4 text-sm text-red-400">Failed to delete. Please try again.</p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
