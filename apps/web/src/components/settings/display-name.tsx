import { fetchMeOrNull } from "@/lib/api/auth.js";
import { patchMe } from "@/lib/api/me.js";
import type { MeResponse } from "@arcadeai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const inputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 360,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-raised)",
  padding: "9px 12px",
  fontSize: 13,
  color: "var(--color-text-primary)",
  fontFamily: "inherit",
  outline: "none",
  transition: "border-color 0.15s",
};

export function DisplayName() {
  const queryClient = useQueryClient();
  // Pass queryFn so this query is self-sufficient if the cache is ever
  // cleared (e.g. after sign-out + back-button) — without it the query
  // would sit in `pending` forever because the global queryClient has
  // no default queryFn.
  const { data: me } = useQuery<MeResponse | null>({
    queryKey: ["me"],
    queryFn: fetchMeOrNull,
  });
  const [value, setValue] = useState(me?.displayName ?? "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional initialization only on first load
  useEffect(() => {
    if (me?.displayName && !value) setValue(me.displayName);
  }, [me?.displayName]);

  const mutation = useMutation({
    mutationFn: (name: string) => patchMe({ display_name: name }),
    onMutate: () => {
      setStatus("saving");
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], data);
      setStatus("saved");
      timerRef.current = setTimeout(() => setStatus("idle"), 1500);
    },
    onError: () => {
      setStatus("error");
      setValue(me?.displayName ?? "");
    },
  });

  function handleBlur() {
    const trimmed = value.trim();
    if (trimmed === me?.displayName) return;
    if (trimmed.length === 0) {
      setValue(me?.displayName ?? "");
      return;
    }
    mutation.mutate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
  }

  const statusColor =
    status === "saving"
      ? "var(--color-text-muted)"
      : status === "saved"
        ? "var(--color-success)"
        : status === "error"
          ? "var(--color-danger)"
          : "";

  const statusLabel =
    status === "saving"
      ? "Saving..."
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? "Could not save"
          : null;

  return (
    <div>
      <label
        htmlFor="display-name"
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          marginBottom: 6,
        }}
      >
        Display name
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          id="display-name"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor = "rgba(255,62,165,0.5)";
          }}
          maxLength={80}
          style={inputStyle}
          placeholder="Your display name"
        />
        {statusLabel && <span style={{ fontSize: 11, color: statusColor }}>{statusLabel}</span>}
      </div>
    </div>
  );
}
