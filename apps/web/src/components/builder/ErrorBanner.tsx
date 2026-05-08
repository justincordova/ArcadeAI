// Red error banner shown below the chat log on a stream failure. When the
// hook surfaces a "/pricing" cue, we render an inline upgrade button so a
// credit-exhausted user doesn't have to hunt for the pricing link in the
// top bar.

import { Link } from "@tanstack/react-router";

export function ErrorBanner({ message }: { message: string }) {
  const showUpgrade = message.includes("/pricing");
  const text = showUpgrade ? message.replace(/Upgrade on \/pricing\.?/i, "").trim() : message;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid rgba(244,63,94,0.3)",
        background: "rgba(244,63,94,0.08)",
        fontSize: 13,
        color: "var(--color-danger)",
        marginTop: 8,
      }}
    >
      <span>{text}</span>
      {showUpgrade && (
        <Link
          to="/pricing"
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
            background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)",
            color: "#fff",
          }}
        >
          Upgrade plan
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <title>Arrow right</title>
            <path
              d="M2.5 6h7M6.5 3l3 3-3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      )}
    </div>
  );
}
