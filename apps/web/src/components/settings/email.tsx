import type { MeResponse } from "@arcadeai/shared";
import { useQuery } from "@tanstack/react-query";

export function Email() {
  const { data: me } = useQuery<MeResponse | null>({ queryKey: ["me"] });

  return (
    <div>
      <p
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          marginBottom: 4,
        }}
      >
        Email
      </p>
      <p style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{me?.email ?? "—"}</p>
      <p style={{ marginTop: 4, fontSize: 11, color: "var(--color-text-muted)" }}>
        Sourced from your sign-in provider.
      </p>
    </div>
  );
}
