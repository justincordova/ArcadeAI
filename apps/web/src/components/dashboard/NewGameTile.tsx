import { Link } from "@tanstack/react-router";

export function NewGameTile() {
  return (
    <Link to="/game/new" style={{ textDecoration: "none" }}>
      <div
        className="group"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          aspectRatio: "16/9",
          borderRadius: 14,
          border: "1.5px dashed var(--color-border)",
          background: "transparent",
          cursor: "pointer",
          transition: "all 0.2s",
          gap: 8,
          position: "relative",
          overflow: "hidden",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = "rgba(124,58,237,0.5)";
          el.style.background = "rgba(124,58,237,0.05)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = "var(--color-border)";
          el.style.background = "transparent";
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 3v10M3 8h10"
              stroke="url(#new-game-grad)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="new-game-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--color-text-muted)",
            letterSpacing: "0.04em",
          }}
        >
          New Game
        </span>
      </div>
    </Link>
  );
}
