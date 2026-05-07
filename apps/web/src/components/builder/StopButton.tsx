interface StopButtonProps {
  visible: boolean;
  onStop: () => void;
}

export function StopButton({ visible, onStop }: StopButtonProps) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
      }}
    >
      <button
        type="button"
        onClick={onStop}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 18px",
          borderRadius: 10,
          border: "1px solid rgba(244,63,94,0.35)",
          background: "rgba(244,63,94,0.12)",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-danger)",
          cursor: "pointer",
          fontFamily: "inherit",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(244,63,94,0.2)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(244,63,94,0.5)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(244,63,94,0.12)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(244,63,94,0.35)";
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
        Stop
      </button>
    </div>
  );
}
