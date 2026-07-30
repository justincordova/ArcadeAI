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
    // Paint in onMutate (runs synchronously before the request) so the UI feels
    // responsive, and capture the previous value so we can roll back.
    onMutate: (theme: Theme) => {
      const previous = serverTheme ?? storedTheme();
      applyTheme(theme);
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], data);
    },
    onError: (_err, _theme, context) => {
      // Roll back. applyTheme writes both the DOM and localStorage, so without
      // this a failed PATCH left the app painted with the rejected theme while
      // `theme` below still reported the server value — the settings toggle and
      // the actual appearance disagreed, with nothing surfacing the error. The
      // stale localStorage value also made the pre-hydration script in
      // index.html paint the wrong theme on every subsequent load.
      if (context?.previous) applyTheme(context.previous);
    },
  });

  function setTheme(theme: Theme) {
    mutation.mutate(theme);
  }

  return {
    theme: serverTheme ?? storedTheme(),
    setTheme,
    isSaving: mutation.isPending,
    isError: mutation.isError,
  };
}
