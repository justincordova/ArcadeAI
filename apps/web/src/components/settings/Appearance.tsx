// Appearance / theme control. Lets the user pick Dark, Light, or System;
// the choice paints immediately (useTheme -> applyTheme) and persists to the
// API. "System" follows the OS colour scheme live.

import type { Theme } from "@arcadeai/shared";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme.js";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
];

export function Appearance() {
  const { theme, setTheme, isSaving } = useTheme();

  return (
    <div>
      <p
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          marginBottom: 8,
        }}
      >
        Theme
      </p>
      <div
        style={{
          display: "inline-flex",
          gap: 2,
          padding: 4,
          borderRadius: 10,
          background: "var(--color-surface-raised)",
          border: "1px solid var(--color-border)",
        }}
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              disabled={isSaving}
              aria-pressed={active}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: isSaving ? "wait" : "pointer",
                border: "none",
                transition: "all 0.15s",
                background: active ? "var(--gradient-brand-soft)" : "transparent",
                color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
              }}
            >
              <Icon size={14} strokeWidth={2} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 10 }}>
        System follows your device's light or dark setting.
      </p>
    </div>
  );
}
