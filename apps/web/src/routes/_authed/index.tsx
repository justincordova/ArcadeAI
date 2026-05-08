import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { EmptyState } from "../../components/dashboard/EmptyState.js";
import { GameGrid } from "../../components/dashboard/GameGrid.js";
import { GAMES_QUERY_KEY, listGames } from "../../lib/api/games.js";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
});

type ViewMode = "grid" | "list";

const VIEW_KEY = "dashboard-view";

function getStoredView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "list" || v === "grid") return v;
  } catch {}
  return "grid";
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
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#06b6d4" />
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
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Dashboard() {
  const [view, setView] = useState<ViewMode>(getStoredView);

  const { data, isLoading } = useQuery({
    queryKey: GAMES_QUERY_KEY,
    queryFn: listGames,
  });

  function switchView(next: ViewMode) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  }

  const games = data ?? [];

  return (
    <div
      style={{
        minHeight: "calc(100vh - 56px)",
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
            "linear-gradient(rgba(124,58,237,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.03) 1px, transparent 1px)",
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
          background: "radial-gradient(ellipse, rgba(124,58,237,0.07) 0%, transparent 70%)",
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
            {!isLoading && games.length > 0 && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                {games.length} {games.length === 1 ? "game" : "games"}
              </p>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* View toggle */}
            {!isLoading && games.length > 0 && (
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

            {/* New game CTA */}
            <Link
              to="/game/new"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "9px 18px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                textDecoration: "none",
                background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)",
                color: "#fff",
                transition: "opacity 0.15s",
                boxShadow: "0 2px 12px rgba(124,58,237,0.3)",
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                (e.currentTarget as HTMLAnchorElement).style.opacity = "0.88";
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                (e.currentTarget as HTMLAnchorElement).style.opacity = "1";
              }}
            >
              <Plus size={13} strokeWidth={2.4} />
              New Game
            </Link>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 320,
              gap: 12,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "2px solid var(--color-border)",
                borderTopColor: "var(--color-accent-violet)",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
          </div>
        ) : games.length === 0 ? (
          <EmptyState />
        ) : (
          <GameGrid games={games} view={view} />
        )}
      </div>
    </div>
  );
}
