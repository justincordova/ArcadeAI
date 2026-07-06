// Loading-state placeholders for the dashboard. Layout mirrors the real
// GameCard so the page doesn't reflow when the data lands.

interface SkeletonProps {
  view: "grid" | "list";
  count?: number;
}

export function GameCardSkeletons({ view, count = 6 }: SkeletonProps) {
  return (
    <div
      style={
        view === "grid"
          ? {
              display: "grid",
              // Must match GameGrid's template exactly — the whole point of
              // this component is zero reflow when data lands. auto-fill
              // here vs repeat(3) there changed the column count at most
              // viewport widths, so the load visibly reflowed anyway.
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 14,
            }
          : { display: "flex", flexDirection: "column", gap: 8 }
      }
    >
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable list of placeholder cards, never reordered
        <SkeletonCard key={i} view={view} />
      ))}
    </div>
  );
}

function SkeletonCard({ view }: { view: "grid" | "list" }) {
  if (view === "list") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid var(--color-border)",
        }}
      >
        <Shimmer style={{ width: 64, height: 40, borderRadius: 6 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <Shimmer style={{ width: "60%", height: 12, borderRadius: 4 }} />
          <Shimmer style={{ width: "30%", height: 10, borderRadius: 4 }} />
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        overflow: "hidden",
      }}
    >
      <Shimmer style={{ width: "100%", aspectRatio: "16 / 10", borderRadius: 0 }} />
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <Shimmer style={{ width: "70%", height: 12, borderRadius: 4 }} />
        <Shimmer style={{ width: "40%", height: 10, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function Shimmer({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="animate-pulse"
      style={{
        background: "var(--color-border)",
        ...style,
      }}
    />
  );
}
