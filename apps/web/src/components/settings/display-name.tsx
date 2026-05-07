import type { MeResponse } from "@arcadeai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { patchMe } from "../../lib/api/me.js";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function DisplayName() {
  const queryClient = useQueryClient();
  const { data: me } = useQuery<MeResponse | null>({ queryKey: ["me"] });
  const [value, setValue] = useState(me?.displayName ?? "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize once me loads
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

  const statusLabel =
    status === "saving"
      ? "Saving..."
      : status === "saved"
        ? "Saved ✓"
        : status === "error"
          ? "Couldn't save"
          : null;

  const statusColor =
    status === "saving"
      ? "text-gray-400"
      : status === "saved"
        ? "text-green-400"
        : status === "error"
          ? "text-red-400"
          : "";

  return (
    <div>
      <label htmlFor="display-name" className="mb-1 block text-sm font-medium text-gray-300">
        Display name
      </label>
      <div className="flex items-center gap-3">
        <input
          id="display-name"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          maxLength={80}
          className="w-full max-w-sm rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-gray-500 focus:outline-none"
        />
        {statusLabel && <span className={`text-xs ${statusColor}`}>{statusLabel}</span>}
      </div>
    </div>
  );
}
