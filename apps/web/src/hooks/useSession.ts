import type { MeResponse } from "@arcadeai/shared";
import { useQuery } from "@tanstack/react-query";
import { fetchMeOrNull } from "../lib/api/auth.js";

export function useSession() {
  return useQuery<MeResponse | null>({
    queryKey: ["me"],
    queryFn: fetchMeOrNull,
    retry: false,
    // 15s — short enough that returning to a tab after a reset boundary
    // (daily/monthly) sees fresh counters without manual refresh, long
    // enough that snappy navigation doesn't refire on every route change.
    staleTime: 15_000,
  });
}
