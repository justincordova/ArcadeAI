import { useId } from "react";

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * ArcadeAI logo — a stylized arcade cabinet with a CRT screen and
 * joystick/buttons. Filled with the brand gradient (magenta → purple →
 * cyan). The mark is intentionally chunky so it reads at small sizes.
 *
 * Each instance uses a unique gradient id so multiple logos on the same
 * page (e.g. logo + favicon-style mark in a card) don't collide and
 * fail to render in older Safari builds.
 */
export function LogoMark({ size = 28, className = "" }: LogoProps) {
  // Per-instance gradient id via useId — stable across re-renders (a
  // Math.random() id re-randomized every render, churning the gradient def
  // and url() references) and SSR-safe.
  const gradId = `logo-grad-${useId()}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#ff3ea5" />
          <stop offset="55%" stopColor="#b14de8" />
          <stop offset="100%" stopColor="#4cdfe8" />
        </linearGradient>
      </defs>
      {/* Cabinet top arc */}
      <path
        d="M6 14 C6 7 10 4 16 4 C22 4 26 7 26 14"
        stroke={`url(#${gradId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Cabinet sides */}
      <path
        d="M6 14 L5 26 C5 27.1 5.9 28 7 28 L25 28 C26.1 28 27 27.1 27 26 L26 14"
        stroke={`url(#${gradId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Screen bezel */}
      <rect
        x="10"
        y="12"
        width="12"
        height="8"
        rx="1.5"
        stroke={`url(#${gradId})`}
        strokeWidth="1.5"
        fill="none"
      />
      {/* Joystick dot */}
      <circle cx="13" cy="23" r="1.5" fill={`url(#${gradId})`} />
      {/* Buttons */}
      <circle cx="19" cy="22.5" r="1" fill={`url(#${gradId})`} />
      <circle cx="22" cy="23.5" r="1" fill={`url(#${gradId})`} />
    </svg>
  );
}

// All three consumers are header bars (TopBar, discover, play), and all
// three are tight for horizontal room on a phone. The wordmark is the
// single largest non-shrinkable item in them at ~79px, so it drops below
// `sm` and the mark carries the brand on its own — the usual icon-only
// treatment. Nothing else needs to change at the call sites.
export function LogoFull({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 ${className}`}>
      <LogoMark size={26} />
      <span
        className="hidden sm:inline"
        style={{
          backgroundImage: "var(--gradient-brand)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          fontFamily: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        Arcade<span style={{ fontWeight: 500, opacity: 0.85 }}>AI</span>
      </span>
    </span>
  );
}
