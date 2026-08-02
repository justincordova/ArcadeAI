// Sort + genre filter strip for /discover. Sort renders as a pill group
// (Trending / Top / New) with the active one painted in the brand
// gradient; genre is a horizontally-scrollable rail of pills.
//
// The component is presentational — query state lives in the route URL.

import { GENRE_BUCKETS, type GenreBucket } from "@arcadeai/shared";
import { Flame, Sparkles, Star } from "lucide-react";
import type { DiscoverSort } from "@/lib/api/games.js";

const SORT_OPTIONS: Array<{ value: DiscoverSort; label: string; icon: typeof Flame }> = [
  { value: "trending", label: "Trending", icon: Flame },
  { value: "new", label: "New", icon: Sparkles },
  { value: "top", label: "All time", icon: Star },
];

const GENRE_LABEL: Record<GenreBucket, string> = {
  paddle: "Paddle",
  snake: "Snake",
  flappy: "Flappy",
  shooter: "Shooter",
  platformer: "Platformer",
  puzzle: "Puzzle",
  runner: "Runner",
  other: "Other",
};

interface FiltersProps {
  sort: DiscoverSort;
  onSortChange: (s: DiscoverSort) => void;
  genre: string | null;
  onGenreChange: (g: string | null) => void;
}

export function DiscoverFilters({ sort, onSortChange, genre, onGenreChange }: FiltersProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      {/* Sort pill group */}
      {/* Not a tablist. These reorder the gallery in place via a URL param
          rather than swapping panels, and the ARIA tabs pattern would owe a
          tabpanel, aria-controls, roving tabindex, and arrow-key handling —
          none of which existed, so screen readers announced "tab 1 of 3" and
          promised keyboard behaviour the component did not implement.
          Toggle buttons in a labelled group is what they actually are, and
          matches DashboardToolbar's FilterPill and IntervalToggle. */}
      <div
        role="group"
        aria-label="Sort"
        style={{
          display: "inline-flex",
          padding: 3,
          borderRadius: 10,
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        {SORT_OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = sort === value;
          return (
            <button
              type="button"
              aria-pressed={active}
              key={value}
              onClick={() => onSortChange(value)}
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.01em",
                fontFamily: "inherit",
                border: "none",
                background: active ? "var(--color-surface-raised)" : "transparent",
                color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                cursor: "pointer",
                transition: "all 0.12s",
                boxShadow: active ? "inset 0 0 0 1px rgba(255,62,165,0.35)" : "none",
              }}
            >
              <Icon
                size={12}
                strokeWidth={2}
                style={{
                  color: active ? "var(--color-accent-primary)" : "var(--color-text-muted)",
                }}
              />
              {label}
            </button>
          );
        })}
      </div>

      {/* Genre rail — horizontally scrollable on narrow screens */}
      <div
        role="group"
        aria-label="Filter by genre"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          overflowX: "auto",
          flex: 1,
          minWidth: 0,
          paddingBottom: 2,
        }}
      >
        <GenrePill label="All" active={genre === null} onClick={() => onGenreChange(null)} />
        {GENRE_BUCKETS.map((g) => (
          <GenrePill
            key={g}
            label={GENRE_LABEL[g]}
            active={genre === g}
            onClick={() => onGenreChange(g)}
          />
        ))}
      </div>
    </div>
  );
}

function GenrePill({
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
      // The selected genre was signalled by background and border only, so
      // the active filter was invisible to assistive tech.
      aria-pressed={active}
      style={{
        flexShrink: 0,
        padding: "5px 12px",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
        border: active ? "1px solid rgba(255,62,165,0.45)" : "1px solid var(--color-border)",
        background: active
          ? "linear-gradient(105deg, rgba(255,62,165,0.18) 0%, rgba(76,223,232,0.12) 100%)"
          : "transparent",
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        transition: "all 0.12s",
      }}
    >
      {label}
    </button>
  );
}
