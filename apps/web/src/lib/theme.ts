// Theme application. The design system ships a `.light` class on <html>
// (styles/index.css); this module is the single place that decides whether
// that class is present. The user's stored preference is one of
// "dark" | "light" | "system"; "system" resolves live against the OS
// `prefers-color-scheme` and re-resolves when the OS setting changes.
//
// The preference is persisted server-side (users.theme) and mirrored to
// localStorage so the pre-hydration inline script in index.html can apply
// the class before React mounts, avoiding a flash of the wrong theme.

import type { Theme } from "@arcadeai/shared";

export const THEME_STORAGE_KEY = "arcadeai-theme";

/** The concrete theme actually rendered — "system" collapses to one of these. */
type ResolvedTheme = "dark" | "light";

function prefersLight(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

/** Resolve a stored preference to the concrete theme to paint. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return prefersLight() ? "light" : "dark";
  return theme;
}

/** Toggle the `.light` class on <html> to match the resolved theme. */
function paint(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  // Keep the browser UI (address bar) in step with the surface colour.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "light" ? "#faf8f1" : "#08070d");
}

// Tracks the active matchMedia listener so switching away from "system"
// removes it (avoids leaking listeners / stale toggles).
let systemQuery: MediaQueryList | null = null;
let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

function detachSystemListener() {
  if (systemQuery && systemListener) {
    systemQuery.removeEventListener("change", systemListener);
  }
  systemQuery = null;
  systemListener = null;
}

/**
 * Apply a theme preference: paints immediately, persists to localStorage,
 * and (only for "system") subscribes to OS changes so the app follows the
 * OS live. Call this on load once `me.theme` is known and whenever the user
 * changes the preference.
 */
export function applyTheme(theme: Theme) {
  detachSystemListener();
  paint(resolveTheme(theme));

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}

  if (theme === "system" && typeof window.matchMedia === "function") {
    systemQuery = window.matchMedia("(prefers-color-scheme: light)");
    systemListener = (e) => paint(e.matches ? "light" : "dark");
    systemQuery.addEventListener("change", systemListener);
  }
}

/** Read the last-persisted preference (defaults to "dark"). */
export function storedTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "dark" || raw === "light" || raw === "system") return raw;
  } catch {}
  return "dark";
}
