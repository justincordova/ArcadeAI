export type Theme = "dark" | "light" | "system";

const STORAGE_KEY = "theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "dark"; // SPEC §5: default 'dark'
}

export function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  // Dark is declared in :root and is the default. Light overrides via the
  // .light class so the absence of the class always means dark — avoids
  // FOUC on first paint before this code runs.
  root.classList.toggle("light", resolved === "light");
  // Keep .dark on the root too for any third-party libs that key off it.
  root.classList.toggle("dark", resolved === "dark");
  window.localStorage.setItem(STORAGE_KEY, theme);
}
