// Dashboard search / genre-filter / sort controls. Stateless presentation —
// the parent owns query state (search input, genre, sort key) and persists
// the genre+sort selections to localStorage so a refresh doesn't lose them.

import { Search, X } from "lucide-react";

export type SortKey = "updated" | "created" | "title";
export type GenreFilter = "all" | string;

interface DashboardToolbarProps {
  query: string;
  onQueryChange: (q: string) => void;
  genres: string[];
  genre: GenreFilter;
  onGenreChange: (g: GenreFilter) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
}

const SORT_LABEL: Record<SortKey, string> = {
  updated: "Recently edited",
  created: "Recently created",
  title: "Title (A–Z)",
};

const GENRE_LABEL: Record<string, string> = {
  paddle: "Paddle",
  snake: "Snake",
  flappy: "Flappy",
  shooter: "Shooter",
  platformer: "Platformer",
  puzzle: "Puzzle",
  runner: "Runner",
  other: "Other",
};

export function DashboardToolbar({
  query,
  onQueryChange,
  genres,
  genre,
  onGenreChange,
  sort,
  onSortChange,
}: DashboardToolbarProps) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        marginBottom: 18,
      }}
    >
      {/* Search */}
      <div
        style={{
          position: "relative",
          flex: "1 1 240px",
          maxWidth: 360,
          minWidth: 200,
        }}
      >
        <Search
          size={13}
          strokeWidth={2}
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--color-text-muted)",
            pointerEvents: "none",
          }}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search games…"
          aria-label="Search games"
          style={{
            width: "100%",
            padding: "7px 30px 7px 30px",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text-primary)",
            fontSize: 12,
            fontFamily: "inherit",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor = "rgba(255,62,165,0.4)";
          }}
          onBlur={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor = "var(--color-border)";
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              border: "none",
              background: "transparent",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              borderRadius: 4,
            }}
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Genre filter pills — only render if any games have a genre */}
      {genres.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          <FilterPill label="All" active={genre === "all"} onClick={() => onGenreChange("all")} />
          {genres.map((g) => (
            <FilterPill
              key={g}
              label={GENRE_LABEL[g] ?? g}
              active={genre === g}
              onClick={() => onGenreChange(g)}
            />
          ))}
        </div>
      )}

      {/* Sort */}
      <div style={{ marginLeft: "auto" }}>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          aria-label="Sort games"
          style={{
            padding: "6px 26px 6px 10px",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text-secondary)",
            fontSize: 12,
            fontFamily: "inherit",
            cursor: "pointer",
            appearance: "none",
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10' fill='none'><path d='M2.5 4l2.5 2.5L7.5 4' stroke='%237878a0' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 8px center",
          }}
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 11px",
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "inherit",
        border: active ? "1px solid rgba(255,62,165,0.4)" : "1px solid var(--color-border)",
        background: active
          ? "linear-gradient(135deg, rgba(255,62,165,0.12) 0%, rgba(76,223,232,0.12) 100%)"
          : "var(--color-surface)",
        color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
        cursor: "pointer",
        transition: "all 0.12s",
      }}
    >
      {label}
    </button>
  );
}
