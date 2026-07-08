import type { FallbackProps } from "./ErrorBoundary.js";

/**
 * Generic fallback for unhandled render errors. The dev-mode block surfaces
 * the error message so we don't have to dig through the console; production
 * stays generic — leaking stack traces to end users is a security smell and
 * a confidence smell at the same time.
 */
export function RouteError({ error, reset }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  const isDev = import.meta.env.DEV;

  return (
    <div
      role="alert"
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
        color: "var(--color-text-primary)",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
      <p style={{ color: "var(--color-text-secondary)", maxWidth: 480, margin: 0 }}>
        We hit an unexpected error rendering this page. Reloading usually clears it.
      </p>
      {isDev && (
        <pre
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            background: "var(--color-surface)",
            padding: "0.75rem 1rem",
            borderRadius: 6,
            maxWidth: 720,
            overflow: "auto",
            textAlign: "left",
          }}
        >
          {message}
        </pre>
      )}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            background: "transparent",
            color: "var(--color-text-primary)",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 6,
            border: "none",
            // --color-accent-primary is the defined token (index.css);
            // the previous var(--color-accent) doesn't exist, which made
            // the button background transparent and the near-black text
            // invisible on the dark page — a hidden recovery button on
            // the crash screen.
            background: "var(--color-accent-primary)",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}
