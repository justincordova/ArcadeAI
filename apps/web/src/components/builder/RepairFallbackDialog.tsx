interface RepairFallbackDialogProps {
  open: boolean;
  onClose: () => void;
  error: { message: string; stack?: string };
  brokenCode: string;
  onTryAgain: () => void;
  onRefine: () => void;
}

export function RepairFallbackDialog({
  open,
  onClose,
  error,
  brokenCode,
  onTryAgain,
  onRefine,
}: RepairFallbackDialogProps) {
  if (!open) return null;

  const truncatedMessage =
    error.message.length > 200 ? `${error.message.slice(0, 200)}…` : error.message;

  return (
    <dialog
      open
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        margin: 0,
        padding: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        border: "none",
        maxWidth: "none",
        maxHeight: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          margin: "0 16px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "rgba(244,63,94,0.1)",
              border: "1px solid rgba(244,63,94,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M7 4v3M7 10h.01"
                stroke="var(--color-danger)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle
                cx="7"
                cy="7"
                r="5.5"
                stroke="var(--color-danger)"
                strokeWidth="1.2"
                opacity="0.6"
              />
            </svg>
          </div>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            Could not fix this game automatically
          </h2>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px" }}>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-danger)",
              fontFamily: "'Geist Mono', monospace",
              background: "rgba(244,63,94,0.06)",
              border: "1px solid rgba(244,63,94,0.15)",
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 12,
              lineHeight: 1.5,
              wordBreak: "break-word",
            }}
          >
            {truncatedMessage}
          </p>
          <details style={{ cursor: "pointer" }}>
            <summary
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                listStyle: "none",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path
                  d="M3 4l2 2 2-2"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Show broken code
            </summary>
            <pre
              style={{
                marginTop: 8,
                maxHeight: 180,
                overflowY: "auto",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                padding: "10px 12px",
                fontSize: 11,
                color: "var(--color-text-secondary)",
                lineHeight: 1.55,
              }}
            >
              <code>{brokenCode}</code>
            </pre>
          </details>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              fontSize: 13,
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "color 0.12s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-muted)";
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={onRefine}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-raised)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.12s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(124,58,237,0.4)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
            }}
          >
            Refine
          </button>
          <button
            type="button"
            onClick={onTryAgain}
            style={{
              padding: "7px 16px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)",
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "opacity 0.12s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = "0.85";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = "1";
            }}
          >
            Try again
          </button>
        </div>
      </div>
    </dialog>
  );
}
