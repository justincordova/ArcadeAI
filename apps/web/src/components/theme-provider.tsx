import type { MeResponse } from "@arcadeai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { patchMe } from "../lib/api/me.js";
import { applyTheme, getStoredTheme } from "../lib/theme.js";
import type { Theme } from "../lib/theme.js";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const queryClient = useQueryClient();

  const patchMeMutation = useMutation({
    mutationFn: (t: Theme) => patchMe({ theme: t }),
  });

  // Reconcile theme from DB when /api/me loads (SPEC §12 read path)
  const { data: me } = useQuery<MeResponse | null>({ queryKey: ["me"] });
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only reconcile when server theme changes
  useEffect(() => {
    if (me?.theme && me.theme !== theme) {
      applyTheme(me.theme as Theme);
      setThemeState(me.theme as Theme);
    }
  }, [me?.theme]);

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
      setThemeState(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      const prev = theme;
      applyTheme(next);
      setThemeState(next);
      queryClient.setQueryData(["me"], (m: MeResponse | undefined) =>
        m ? { ...m, theme: next } : m
      );
      // Skip network call if unauthenticated
      if (!me) return;
      patchMeMutation.mutate(next, {
        onError: () => {
          applyTheme(prev);
          setThemeState(prev);
          queryClient.setQueryData(["me"], (m: MeResponse | undefined) =>
            m ? { ...m, theme: prev } : m
          );
        },
      });
    },
    [theme, me, queryClient, patchMeMutation]
  );

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}
