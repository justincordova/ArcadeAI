// Global route-level loading fallback. Shown by the router's
// defaultPendingComponent while a route's loader/beforeLoad is resolving,
// so slow navigations (e.g. the auth check in _authed) render a spinner
// instead of a blank or stale screen. The `spin` keyframe is defined
// globally in styles/index.css.

export function RoutePending() {
  return (
    <output
      style={{
        display: "flex",
        minHeight: "60vh",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 12,
        color: "var(--color-text-muted)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "2px solid var(--color-border)",
          borderTopColor: "var(--color-accent-primary)",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <span style={{ fontSize: 13 }}>Loading…</span>
    </output>
  );
}
