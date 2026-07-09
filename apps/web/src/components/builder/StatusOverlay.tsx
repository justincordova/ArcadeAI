export type OverlayStatus = "generating" | "repairing" | "idle";

interface StatusOverlayProps {
  status: OverlayStatus;
}

const LABEL: Record<OverlayStatus, string | null> = {
  generating: "Generating...",
  repairing: "Detected an error, fixing...",
  idle: null,
};

export function StatusOverlay({ status }: StatusOverlayProps) {
  const label = LABEL[status];
  if (!label) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        paddingBottom: 48,
        pointerEvents: "none",
        background: "rgba(9,9,15,0.5)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          borderRadius: 12,
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Spinner */}
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "2px solid var(--color-border)",
            borderTopColor: "var(--color-accent-primary)",
            animation: "overlay-spin 0.7s linear infinite",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            fontWeight: 500,
          }}
        >
          {label}
        </span>
        <style>{"@keyframes overlay-spin { to { transform: rotate(360deg); } }"}</style>
      </div>
    </div>
  );
}
