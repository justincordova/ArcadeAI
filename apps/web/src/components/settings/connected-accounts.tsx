import type { MeResponse } from "@arcadeai/shared";
// Cannot disconnect the last linked provider — disconnect not exposed in this step (SPEC §12).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { linkProviderUrl } from "../../lib/api/me.js";

const PROVIDERS: { id: "google" | "github"; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
];

export function ConnectedAccounts() {
  const { data: me } = useQuery<MeResponse | null>({ queryKey: ["me"] });
  const queryClient = useQueryClient();
  const linked = new Set(me?.linkedProviders ?? []);

  function handleConnect(provider: "google" | "github") {
    // Navigate to Better Auth's link endpoint; on return, /settings will
    // refetch /api/me and update the row.
    const callbackUrl = `${window.location.origin}/settings`;
    window.location.href = `${linkProviderUrl(provider)}?callbackURL=${encodeURIComponent(callbackUrl)}`;
    // Pre-invalidate so the query refetches on next focus/mount
    queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <div>
      <p className="mb-3 text-sm font-medium text-gray-300">Connected accounts</p>
      <div className="space-y-3">
        {PROVIDERS.map((p) => (
          <div key={p.id} className="flex items-center justify-between">
            <span className="text-sm text-gray-200">{p.label}</span>
            {linked.has(p.id) ? (
              <span className="text-xs font-medium text-green-400">✓ Linked</span>
            ) : (
              <button
                type="button"
                onClick={() => handleConnect(p.id)}
                className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1 text-xs text-white hover:bg-gray-700"
              >
                Connect
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
