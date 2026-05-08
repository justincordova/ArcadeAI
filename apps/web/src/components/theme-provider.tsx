import { useThemeSync } from "@/hooks/useThemeSync.js";
import { fetchMeOrNull } from "@/lib/api/auth.js";
import { patchMe } from "@/lib/api/me.js";
import { type Theme, applyTheme, getStoredTheme } from "@/lib/theme.js";
import type { MeResponse } from "@arcadeai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { toast } from "./ui/sonner.js";

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

  // Reconcile theme from DB when /api/me loads (SPEC §12 read path).
  // Explicit queryFn replaces the deleted defaultQueryFn footgun — the cache
  // is shared with useSession, but this guarantees a backstop fetch when the
  // provider mounts on a route that doesn't go through the /_authed guard.
  const { data: me } = useQuery<MeResponse | null>({
    queryKey: ["me"],
    queryFn: fetchMeOrNull,
    retry: false,
    staleTime: 60_000,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only reconcile when server theme changes
  useEffect(() => {
    if (me?.theme && me.theme !== theme) {
      applyTheme(me.theme as Theme);
      setThemeState(me.theme as Theme);
    }
  }, [me?.theme]);

  // System-preference + cross-tab listeners live in useThemeSync.
  useThemeSync(theme, setThemeState);

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
          toast.error("Failed to save theme preference");
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
