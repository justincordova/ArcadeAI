import { type Theme, applyTheme } from "@/lib/theme.js";
import { useEffect } from "react";

/**
 * Keeps the current theme in sync with two external signals:
 *   - `prefers-color-scheme` change (only meaningful when theme === "system")
 *   - `localStorage` "theme" key change from another tab
 *
 * The provider stays the source of truth for in-app changes; this hook
 * reflects environment changes back into the provider via `onExternalChange`
 * (called only for cross-tab updates — system changes apply directly through
 * `applyTheme("system")`).
 */
export function useThemeSync(theme: Theme, onExternalChange: (next: Theme) => void) {
  // System preference change listener
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      if (theme === "system") applyTheme("system");
    }
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  // Cross-tab storage sync
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== "theme" || !e.newValue) return;
      const next = e.newValue as Theme;
      applyTheme(next);
      onExternalChange(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [onExternalChange]);
}
