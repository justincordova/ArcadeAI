interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * ArcadeAI logo — a stylized controller/joystick mark with a gradient.
 * The mark is an abstract "A" formed by an arcade cabinet silhouette.
 */
export function LogoMark({ size = 28, className = "" }: LogoProps) {
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
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      {/* Cabinet top arc */}
      <path
        d="M6 14 C6 7 10 4 16 4 C22 4 26 7 26 14"
        stroke="url(#logo-grad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Cabinet sides */}
      <path
        d="M6 14 L5 26 C5 27.1 5.9 28 7 28 L25 28 C26.1 28 27 27.1 27 26 L26 14"
        stroke="url(#logo-grad)"
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
        stroke="url(#logo-grad)"
        strokeWidth="1.5"
        fill="none"
      />
      {/* Joystick dot */}
      <circle cx="13" cy="23" r="1.5" fill="url(#logo-grad)" />
      {/* Buttons */}
      <circle cx="19" cy="22.5" r="1" fill="url(#logo-grad)" />
      <circle cx="22" cy="23.5" r="1" fill="url(#logo-grad)" />
    </svg>
  );
}

export function LogoFull({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={26} />
      <span
        style={{
          background: "linear-gradient(135deg, #a78bfa 0%, #06b6d4 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
        className="font-mono text-lg font-bold tracking-tight"
      >
        ArcadeAI
      </span>
    </span>
  );
}
