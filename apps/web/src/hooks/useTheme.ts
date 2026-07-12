// Theme state hook. Reads the user's persisted preference from the ["me"]
// query, applies it to the DOM (via lib/theme.applyTheme), and exposes a
// setter that optimistically paints + persists to the API. The pre-hydration
// script in index.html already applied the localStorage value before mount;
// this reconciles with the server value once ["me"] resolves and drives the
// settings control.

import type { MeResponse, Theme } from "@arcadeai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { patchMe } from "@/lib/api/me.js";
import { applyTheme, storedTheme } from "@/lib/theme.js";
import { fetchMeOrNull } from "../lib/api/auth.js";

export function useTheme() {
  const queryClient = useQueryClient();
  const { data: me } = useQuery<MeResponse | null>({
    queryKey: ["me"],
    queryFn: fetchMeOrNull,
  });

  const serverTheme = me?.theme;

  // Reconcile the DOM with the server preference once it's known. If the
  // server value differs from what the pre-hydration script painted (e.g. the
  // user changed it on another device), this corrects it.
  useEffect(() => {
    if (serverTheme) applyTheme(serverTheme);
  }, [serverTheme]);

  const mutation = useMutation({
    mutationFn: (theme: Theme) => patchMe({ theme }),
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], data);
    },
  });

  function setTheme(theme: Theme) {
    // Paint immediately for a responsive feel; persist in the background.
    applyTheme(theme);
    mutation.mutate(theme);
  }

  return {
    theme: serverTheme ?? storedTheme(),
    setTheme,
    isSaving: mutation.isPending,
    isError: mutation.isError,
  };
}
