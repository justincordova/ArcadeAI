// Empty-state shown in the chat panel before any messages exist: a short
// hint plus tappable example prompts. Extracted verbatim from BuilderLayout
// to keep that component focused on layout. Pure presentation — all behavior
// is driven by props.

interface ChatEmptyStateProps {
  /** Non-null when AI keys are missing; suppresses the suggestion buttons. */
  missingKeyError: string | null;
  /** Disables the suggestion buttons while a stream is running. */
  isStreaming: boolean;
  /** Example prompts to render as quick-start buttons. */
  suggestions: readonly string[];
  /** Fired with the chosen suggestion text. */
  onSuggestionClick: (text: string) => void;
}

export function ChatEmptyState({
  missingKeyError,
  isStreaming,
  suggestions,
  onSuggestionClick,
}: ChatEmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 12,
        textAlign: "center",
        padding: "0 8px",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background:
            "linear-gradient(135deg, rgba(255,62,165,0.15) 0%, rgba(76,223,232,0.15) 100%)",
          border: "1px solid rgba(255,62,165,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M9 2.5v13M2.5 9h13"
            stroke="url(#builder-plus)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="builder-plus" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--color-accent-primary)" />
              <stop offset="100%" stopColor="var(--color-accent-secondary)" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
        Describe the game you want to build. Be as specific or vague as you like.
      </p>
      {!missingKeyError && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggestionClick(suggestion)}
              disabled={isStreaming}
              style={{
                padding: "7px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "transparent",
                fontSize: 12,
                color: "var(--color-text-secondary)",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                transition: "all 0.12s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--color-surface-raised)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,62,165,0.3)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
