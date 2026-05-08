import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type React from "react";

export function EmptyState() {
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
          background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)",
          color: "#fff",
          boxShadow: "0 4px 20px rgba(124,58,237,0.35)",
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
        {["Snake", "Breakout", "Flappy Bird clone", "Asteroids", "Pong with AI", "Pac-Man"].map(
          (label) => (
            <span
              key={label}
              style={{
                padding: "4px 12px",
                borderRadius: 9999,
                fontSize: 12,
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              {label}
            </span>
          )
        )}
      </div>
    </div>
  );
}
