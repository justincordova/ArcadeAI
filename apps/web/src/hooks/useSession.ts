import type { MeResponse } from "@arcadeai/shared";
import { useQuery } from "@tanstack/react-query";
import { fetchMeOrNull } from "../lib/api/auth.js";

export function useSession() {
  return useQuery<MeResponse | null>({
    queryKey: ["me"],
    queryFn: fetchMeOrNull,
    retry: false,
    staleTime: 60_000,
  });
}
