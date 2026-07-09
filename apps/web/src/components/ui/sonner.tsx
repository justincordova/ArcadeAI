// Sonner-backed toast container. Uses our color tokens so toasts feel native
// to the active surface. The base sonner theme follows the app theme via the
// same resolver used elsewhere so toasts don't stay dark in light mode.

import { resolveTheme, storedTheme } from "@/lib/theme.js";
import { useEffect, useState } from "react";
import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  const [resolved, setResolved] = useState<"dark" | "light">(() => resolveTheme(storedTheme()));

  // Keep in step with the active theme. applyTheme() toggles the `.light`
  // class on <html>, so a MutationObserver on that class catches every
  // change (explicit dark/light and system re-resolution) in one place.
  useEffect(() => {
    const sync = () =>
      setResolved(document.documentElement.classList.contains("light") ? "light" : "dark");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <SonnerToaster
      theme={resolved}
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.4)]",
          description: "text-[var(--color-text-secondary)]",
          actionButton: "bg-[image:var(--gradient-brand)] text-white",
          cancelButton: "bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]",
          error: "border-[color:var(--color-danger)]",
          success: "border-[color:var(--color-success)]",
        },
      }}
    />
  );
}

// Re-export the toast function so callers don't need to know we're using
// sonner specifically.
export { toast } from "sonner";
