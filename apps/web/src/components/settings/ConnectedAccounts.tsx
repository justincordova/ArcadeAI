import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useSession } from "@/hooks/useSession.js";
import { linkProvider, unlinkProvider } from "@/lib/api/me.js";
import { toast } from "../ui/sonner.js";

const PROVIDERS: { id: "google" | "github"; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
];

export function ConnectedAccounts() {
  const { data: me } = useSession();
  const queryClient = useQueryClient();
  const linked = new Set(me?.linkedProviders ?? []);
  // SPEC §11: never let a user remove their last auth method. The guard is
  // enforced server-side by Better Auth's unlink call too — this is the UX
  // version, disabling the button with an explanatory tooltip.
  const isLastProvider = linked.size <= 1;

  const unlinkMutation = useMutation({
    mutationFn: (provider: "google" | "github") => unlinkProvider(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Provider disconnected");
    },
    onError: () => {
      toast.error("Could not disconnect provider");
    },
  });

  // Linking is a POST that returns the provider's authorization URL; the
  // browser navigation happens here, after the call succeeds.
  const linkMutation = useMutation({
    mutationFn: (provider: "google" | "github") =>
      linkProvider(provider, `${window.location.origin}/settings`),
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: () => {
      toast.error("Could not connect provider");
    },
  });

  function handleConnect(provider: "google" | "github") {
    if (linkMutation.isPending) return;
    linkMutation.mutate(provider);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {PROVIDERS.map((p) => {
        const isLinked = linked.has(p.id);
        const disconnectDisabled = isLinked && isLastProvider;
        const disconnectTooltip = disconnectDisabled
          ? "Connect another provider before disconnecting this one"
          : undefined;

        return (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{p.label}</span>
            {isLinked ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                <button
                  type="button"
                  onClick={() => unlinkMutation.mutate(p.id)}
                  disabled={disconnectDisabled || unlinkMutation.isPending}
                  title={disconnectTooltip}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 7,
                    border: "1px solid var(--color-border)",
                    background: "transparent",
                    fontSize: 12,
                    fontWeight: 600,
                    color: disconnectDisabled
                      ? "var(--color-text-muted)"
                      : "var(--color-text-secondary)",
                    cursor: disconnectDisabled ? "not-allowed" : "pointer",
                    opacity: disconnectDisabled ? 0.5 : 1,
                    fontFamily: "inherit",
                    transition: "all 0.12s",
                  }}
                >
                  Disconnect
                </button>
              </div>
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
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,62,165,0.4)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
                  (e.currentTarget as HTMLButtonElement).style.color =
                    "var(--color-text-secondary)";
                }}
              >
                Connect
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
