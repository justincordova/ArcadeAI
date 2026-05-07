import type { MeResponse } from "@arcadeai/shared";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "../lib/auth.js";

export function useSession() {
  return useQuery<MeResponse | null>({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });
}
