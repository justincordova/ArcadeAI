import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteMe } from "../../lib/api/me.js";

export function DangerZone() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: deleteMe,
    onSuccess: () => {
      queryClient.clear();
      window.location.assign("/sign-in");
    },
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: "9px 16px",
          borderRadius: 8,
          border: "1px solid rgba(244,63,94,0.3)",
          background: "transparent",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-danger)",
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "all 0.12s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(244,63,94,0.08)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(244,63,94,0.5)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(244,63,94,0.3)";
        }}
      >
        Delete account
      </button>

      {open && (
        <dialog
          open
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            margin: 0,
            padding: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            border: "none",
            maxWidth: "none",
            maxHeight: "none",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              margin: "0 16px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "18px 20px",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <h2
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  margin: 0,
                }}
              >
                Delete account?
              </h2>
            </div>

            {/* Body */}
            <div style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                This permanently deletes your account, all your games, and all linked sign-in
                providers. This cannot be undone.
              </p>
              {mutation.error && (
                <p
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: "var(--color-danger)",
                  }}
                >
                  Failed to delete account. Try again.
                </p>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 8,
                padding: "12px 20px",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-text-secondary)",
                  cursor: mutation.isPending ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  opacity: mutation.isPending ? 0.5 : 1,
                  transition: "all 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!mutation.isPending)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "var(--color-surface-raised)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #b91c1c 0%, #f43f5e 100%)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  cursor: mutation.isPending ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  opacity: mutation.isPending ? 0.6 : 1,
                  transition: "opacity 0.12s",
                }}
              >
                {mutation.isPending ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
