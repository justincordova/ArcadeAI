import type { MeResponse } from "@arcadeai/shared";
// Cannot disconnect the last linked provider — disconnect not exposed in this step (SPEC §12).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
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
    const callbackUrl = `${window.location.origin}/settings`;
    window.location.href = `${linkProviderUrl(provider)}?callbackURL=${encodeURIComponent(callbackUrl)}`;
    queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {PROVIDERS.map((p) => (
        <div
          key={p.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{p.label}</span>
          {linked.has(p.id) ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-success)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Check size={12} strokeWidth={2.4} />
              Linked
            </span>
          ) : (
            <button
              type="button"
              onClick={() => handleConnect(p.id)}
              style={{
                padding: "5px 12px",
                borderRadius: 7,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface-raised)",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.12s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(124,58,237,0.4)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
              }}
            >
              Connect
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
