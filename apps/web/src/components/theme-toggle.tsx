import type { Theme } from "../lib/theme.js";
import { useTheme } from "./theme-provider.js";

const NEXT: Record<Theme, Theme> = {
  dark: "light",
  light: "system",
  system: "dark",
};

const ICON: Record<Theme, string> = {
  dark: "🌙",
  light: "☀️",
  system: "🖥",
};

const LABEL: Record<Theme, string> = {
  dark: "Theme: Dark",
  light: "Theme: Light",
  system: "Theme: System",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      type="button"
      title={LABEL[theme]}
      onClick={() => setTheme(NEXT[theme])}
      className="flex h-8 w-8 items-center justify-center rounded-md text-sm hover:bg-gray-800 dark:hover:bg-gray-700"
      aria-label={LABEL[theme]}
    >
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
