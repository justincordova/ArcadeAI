import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type React from "react";

const SUGGESTION_PROMPTS: Record<string, string> = {
  Snake: "A classic snake game on a 20x20 grid with a growing tail and food pellets",
  Breakout: "A breakout/brick-breaker game with a paddle, ball, and rows of colorful bricks",
  "Flappy Bird clone": "A flappy bird clone — tap space to flap, dodge pipes, score points",
  Asteroids:
    "An asteroids game with a ship that wraps around the screen and floating rocks to shoot",
  "Pong with AI": "Pong with an AI opponent that tracks the ball with slight imperfection",
  "Pac-Man": "A simple pac-man game with a small maze, dots to collect, and one ghost chaser",
};

export function EmptyState() {
  const navigate = useNavigate();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 96,
        paddingBottom: 96,
        textAlign: "center",
      }}
    >
      <h2
        style={{
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          color: "var(--color-text-primary)",
          marginBottom: 10,
        }}
      >
        No games yet
      </h2>
      <p
        style={{
          fontSize: 14,
          color: "var(--color-text-secondary)",
          maxWidth: 320,
          lineHeight: 1.65,
          marginBottom: 32,
        }}
      >
        Describe any 2D arcade game and watch it come to life in seconds.
      </p>

      <Link
        to="/game/new"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 24px",
          borderRadius: 11,
          fontSize: 14,
          fontWeight: 700,
          fontFamily: "inherit",
          textDecoration: "none",
          background: "linear-gradient(135deg, #ff3ea5 0%, #4cdfe8 100%)",
          color: "#fff",
          boxShadow: "0 4px 20px rgba(255,62,165,0.35)",
          transition: "opacity 0.15s, transform 0.15s",
        }}
        onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
          (e.currentTarget as HTMLAnchorElement).style.opacity = "0.88";
          (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
          (e.currentTarget as HTMLAnchorElement).style.opacity = "1";
          (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
        }}
      >
        <Plus size={14} strokeWidth={2.4} />
        Create your first game
      </Link>

      {/* Suggestion pills */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "center",
          marginTop: 28,
          maxWidth: 480,
        }}
      >
        {Object.entries(SUGGESTION_PROMPTS).map(([label, prompt]) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate({ to: "/game/new", search: { prompt } })}
            style={{
              padding: "4px 12px",
              borderRadius: 9999,
              fontSize: 12,
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.12s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,62,165,0.4)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-muted)";
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
