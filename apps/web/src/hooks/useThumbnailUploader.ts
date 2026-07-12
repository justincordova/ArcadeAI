// Uploads a captured game thumbnail and refreshes the dashboard list on
// success. Shared by both builder flows (generation and refinement), which
// previously each defined an identical inline callback.
//
// The returned callback is memoized on `queryClient` alone so its identity
// stays stable across streaming re-renders: GameIframe binds it as a message
// listener, and a listener swap mid-stream could drop the iframe's async
// `thumbnail` response in the gap between unbind and rebind.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { GAMES_QUERY_KEY, postThumbnail } from "@/lib/api/games.js";

export function useThumbnailUploader() {
  const queryClient = useQueryClient();

  return useCallback(
    (id: string, dataUrl: string) => {
      postThumbnail(id, dataUrl)
        .then(() => queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY }))
        .catch((err) => console.warn("[thumbnail]", err));
    },
    [queryClient]
  );
}
