import type { BillingInterval } from "@arcadeai/shared";

interface IntervalToggleProps {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}

export function IntervalToggle({ value, onChange }: IntervalToggleProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 4,
        borderRadius: 10,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      {(["monthly", "yearly"] as BillingInterval[]).map((interval) => (
        <button
          key={interval}
          type="button"
          onClick={() => onChange(interval)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 18px",
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            border: "none",
            transition: "all 0.15s",
            background:
              value === interval
                ? "linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(6,182,212,0.25) 100%)"
                : "transparent",
            color: value === interval ? "var(--color-text-primary)" : "var(--color-text-muted)",
          }}
        >
          {interval.charAt(0).toUpperCase() + interval.slice(1)}
          {interval === "yearly" && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(34,211,160,0.15)",
                color: "var(--color-success)",
                letterSpacing: "0.04em",
              }}
            >
              -15%
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
