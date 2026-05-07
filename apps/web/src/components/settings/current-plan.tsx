import type { MeResponse } from "@arcadeai/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

export function CurrentPlan() {
  const { data: me } = useQuery<MeResponse | null>({ queryKey: ["me"] });
  const tier = me?.tier ?? "free";

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-gray-300">Current plan</p>
      <div className="flex items-center gap-4">
        <span className="text-sm capitalize text-gray-200">{tier}</span>
        <Link to="/pricing" className="text-xs text-indigo-400 hover:text-indigo-300">
          Manage in Pricing →
        </Link>
      </div>
    </div>
  );
}
