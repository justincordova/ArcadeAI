// Three pulsing dots + a label, shown in the chat panel during a streaming
// generation or refinement. The pulse-dot keyframes live in styles/index.css.

export function StreamingIndicator({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: "14px 14px 14px 4px",
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border)",
        width: "fit-content",
        marginBottom: 16,
      }}
    >
      <span style={{ display: "flex", gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #a78bfa, #4cdfe8)",
              animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </span>
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{label}</span>
    </div>
  );
}
