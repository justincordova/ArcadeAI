import {
  DashboardToolbar,
  type GenreFilter,
  type SortKey,
} from "@/components/dashboard/DashboardToolbar.js";
import { EmptyState } from "@/components/dashboard/EmptyState.js";
import { GameCardSkeletons } from "@/components/dashboard/GameCardSkeleton.js";
import { GameGrid } from "@/components/dashboard/GameGrid.js";
import { Button } from "@/components/ui/button.js";
import { GAMES_QUERY_KEY, type GameSummary, listGames } from "@/lib/api/games.js";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Plus } from "lucide-react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
});

type ViewMode = "grid" | "list";

const VIEW_KEY = "dashboard-view";
const SORT_KEY = "dashboard-sort";
const GENRE_KEY = "dashboard-genre";

function getStoredView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "list" || v === "grid") return v;
  } catch {}
  return "grid";
}

function getStoredSort(): SortKey {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (v === "updated" || v === "created" || v === "title") return v;
  } catch {}
  return "updated";
}

function getStoredGenre(): GenreFilter {
  try {
    const v = localStorage.getItem(GENRE_KEY);
    if (typeof v === "string" && v.length > 0) return v as GenreFilter;
  } catch {}
  return "all";
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="6"
        height="6"
        rx="1.5"
        fill={active ? "url(#view-grad)" : "currentColor"}
        opacity={active ? 1 : 0.4}
      />
      <rect
        x="9"
        y="1"
        width="6"
        height="6"
        rx="1.5"
        fill={active ? "url(#view-grad)" : "currentColor"}
        opacity={active ? 1 : 0.4}
      />
      <rect
        x="1"
        y="9"
        width="6"
        height="6"
        rx="1.5"
        fill={active ? "url(#view-grad)" : "currentColor"}
        opacity={active ? 1 : 0.4}
      />
      <rect
        x="9"
        y="9"
        width="6"
        height="6"
        rx="1.5"
        fill={active ? "url(#view-grad)" : "currentColor"}
        opacity={active ? 1 : 0.4}
      />
      <defs>
        <linearGradient id="view-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-accent-primary)" />
          <stop offset="100%" stopColor="var(--color-accent-secondary)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="1"
        y="2"
        width="14"
        height="3"
        rx="1.5"
        fill={active ? "url(#view-grad2)" : "currentColor"}
        opacity={active ? 1 : 0.4}
      />
      <rect
        x="1"
        y="6.5"
        width="14"
        height="3"
        rx="1.5"
        fill={active ? "url(#view-grad2)" : "currentColor"}
        opacity={active ? 1 : 0.4}
      />
      <rect
        x="1"
        y="11"
        width="14"
        height="3"
        rx="1.5"
        fill={active ? "url(#view-grad2)" : "currentColor"}
        opacity={active ? 1 : 0.4}
      />
      <defs>
        <linearGradient id="view-grad2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-accent-primary)" />
          <stop offset="100%" stopColor="var(--color-accent-secondary)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Dashboard() {
  const [view, setView] = useState<ViewMode>(getStoredView);
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<GenreFilter>(getStoredGenre);
  const [sort, setSort] = useState<SortKey>(getStoredSort);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: GAMES_QUERY_KEY,
    queryFn: listGames,
  });

  function switchView(next: ViewMode) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  }

  function handleSortChange(next: SortKey) {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {}
  }

  function handleGenreChange(next: GenreFilter) {
    setGenre(next);
    try {
      localStorage.setItem(GENRE_KEY, next);
    } catch {}
  }

  const games = data ?? [];

  // Available genre filters — only show pills for genres that actually
  // appear in the user's library.
  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) {
      if (g.genre) set.add(g.genre);
    }
    return Array.from(set).sort();
  }, [games]);

  const filteredGames = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = games as GameSummary[];
    if (q) {
      out = out.filter((g) => g.title.toLowerCase().includes(q));
    }
    if (genre !== "all") {
      out = out.filter((g) => g.genre === genre);
    }
    const sorted = [...out];
    switch (sort) {
      case "updated":
        sorted.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case "created":
        sorted.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case "title":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }
    return sorted;
  }, [games, query, genre, sort]);

  const hasGames = games.length > 0;
  const hasResults = filteredGames.length > 0;

  return (
    <div
      style={{
        minHeight: "calc(100vh - var(--layout-topbar-h))",
        background: "var(--color-bg)",
        position: "relative",
      }}
    >
      {/* Background grid */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,62,165,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,62,165,0.03) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          top: -80,
          right: -80,
          width: 480,
          height: 480,
          background: "radial-gradient(ellipse, rgba(255,62,165,0.07) 0%, transparent 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1200,
          margin: "0 auto",
          padding: "36px 24px",
        }}
      >
        {/* Page header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 28,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "var(--color-text-primary)",
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              My Games
            </h1>
            {!isLoading && hasGames && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                {filteredGames.length === games.length
                  ? `${games.length} ${games.length === 1 ? "game" : "games"}`
                  : `${filteredGames.length} of ${games.length}`}
              </p>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* View toggle */}
            {!isLoading && hasGames && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  padding: 3,
                  borderRadius: 8,
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {(["grid", "list"] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => switchView(v)}
                    aria-label={v === "grid" ? "Grid view" : "List view"}
                    aria-pressed={view === v}
                    title={v === "grid" ? "Grid view" : "List view"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      border: "none",
                      background: view === v ? "var(--color-surface-raised)" : "transparent",
                      color: view === v ? "var(--color-text-primary)" : "var(--color-text-muted)",
                      cursor: "pointer",
                      transition: "all 0.12s",
                    }}
                  >
                    {v === "grid" ? (
                      <GridIcon active={view === "grid"} />
                    ) : (
                      <ListIcon active={view === "list"} />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* New game CTA — primary Button wrapping the router Link via
                asChild, so the brand-gradient fill and hover come from the
                shared variant instead of an inline opacity handler. */}
            <Button
              asChild
              variant="primary"
              className="h-auto gap-[7px] rounded-[10px] px-[18px] py-[9px] text-[13px]"
            >
              <Link to="/game/new">
                <Plus size={13} strokeWidth={2.4} />
                New Game
              </Link>
            </Button>
          </div>
        </div>

        {/* Toolbar — only when the library loaded and has games */}
        {!isLoading && !isError && hasGames && (
          <DashboardToolbar
            query={query}
            onQueryChange={setQuery}
            genres={availableGenres}
            genre={genre}
            onGenreChange={handleGenreChange}
            sort={sort}
            onSortChange={handleSortChange}
          />
        )}

        {/* Content */}
        {isLoading ? (
          <GameCardSkeletons view={view} />
        ) : isError ? (
          <LoadError onRetry={() => void refetch()} />
        ) : !hasGames ? (
          <EmptyState />
        ) : !hasResults ? (
          <NoResults
            onClear={() => {
              setQuery("");
              handleGenreChange("all");
            }}
          />
        ) : (
          <GameGrid games={filteredGames} view={view} />
        )}
      </div>
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 80,
        paddingBottom: 80,
        textAlign: "center",
        gap: 12,
      }}
    >
      <AlertCircle size={28} strokeWidth={1.8} style={{ color: "var(--color-danger)" }} />
      <p style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
        Couldn't load your games. Check your connection and try again.
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function NoResults({ onClear }: { onClear: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 80,
        paddingBottom: 80,
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 14 }}>
        No games match your filters.
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}
