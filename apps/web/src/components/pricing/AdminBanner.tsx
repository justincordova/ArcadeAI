export function AdminBanner() {
  return (
    <div
      style={{
        marginBottom: 32,
        borderRadius: 12,
        padding: "14px 20px",
        textAlign: "center",
        background: "linear-gradient(135deg, rgba(255,62,165,0.1) 0%, rgba(76,223,232,0.1) 100%)",
        border: "1px solid rgba(255,62,165,0.25)",
      }}
    >
      <p
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-accent-primary-soft)",
        }}
      >
        Admin access — all features unlocked.
      </p>
    </div>
  );
}
