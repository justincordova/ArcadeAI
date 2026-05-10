// Sonner-backed toast container. Uses our color tokens so toasts feel
// native to the app's dark surface.

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.4)]",
          description: "text-[var(--color-text-secondary)]",
          actionButton: "bg-gradient-to-br from-[#ff3ea5] to-[#4cdfe8] text-white",
          cancelButton: "bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]",
          error: "border-[rgba(244,63,94,0.4)]",
          success: "border-[rgba(34,211,160,0.4)]",
        },
      }}
    />
  );
}

// Re-export the toast function so callers don't need to know we're using
// sonner specifically.
export { toast } from "sonner";
