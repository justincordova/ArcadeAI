import type { MeResponse } from "@arcadeai/shared";
import { useQuery } from "@tanstack/react-query";

export function Email() {
  const { data: me } = useQuery<MeResponse | null>({ queryKey: ["me"] });

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-gray-300">Email</p>
      <p className="text-sm text-gray-200">{me?.email ?? "—"}</p>
      <p className="mt-0.5 text-xs text-gray-500">Sourced from your sign-in provider.</p>
    </div>
  );
}
