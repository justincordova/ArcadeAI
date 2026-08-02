// Shown when auto-repair has exhausted its 2 attempts. Lets the user
// inspect the error, view the broken code, and choose to either try
// again from the original prompt or treat it as a refinement turn.

import { AlertCircle, ChevronDown } from "lucide-react";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";

interface RepairFallbackDialogProps {
  open: boolean;
  onClose: () => void;
  error: { message: string; stack?: string };
  brokenCode: string;
  onTryAgain: () => void;
  onRefine: () => void;
}

export function RepairFallbackDialog({
  open,
  onClose,
  error,
  brokenCode,
  onTryAgain,
  onRefine,
}: RepairFallbackDialogProps) {
  const truncatedMessage =
    error.message.length > 200 ? `${error.message.slice(0, 200)}…` : error.message;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "rgba(244,63,94,0.1)",
                border: "1px solid rgba(244,63,94,0.25)",
              }}
            >
              <AlertCircle className="h-3.5 w-3.5" style={{ color: "var(--color-danger)" }} />
            </span>
            Could not fix this game automatically
          </DialogTitle>
        </DialogHeader>

        {/* DialogDescription rather than a bare <p>: Radix always stamps
            aria-describedby onto the dialog, so with no description
            rendered this was the one dialog in the app pointing at an id
            that existed nowhere in the DOM. The error text is the
            description, so wiring it up is also the accurate markup.
            Renders a <p>; inline styles win over the component's defaults. */}
        <DialogDescription
          className="font-mono"
          style={{
            fontSize: 12,
            color: "var(--color-danger)",
            background: "rgba(244,63,94,0.06)",
            border: "1px solid rgba(244,63,94,0.15)",
            borderRadius: 8,
            padding: "10px 12px",
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
        >
          {truncatedMessage}
        </DialogDescription>
        <details style={{ cursor: "pointer", marginTop: 12 }}>
          <summary
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              listStyle: "none",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <ChevronDown className="h-2.5 w-2.5" />
            Show broken code
          </summary>
          <pre
            style={{
              marginTop: 8,
              maxHeight: 180,
              overflowY: "auto",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
              padding: "10px 12px",
              fontSize: 11,
              color: "var(--color-text-secondary)",
              lineHeight: 1.55,
            }}
          >
            <code>{brokenCode}</code>
          </pre>
        </details>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" size="sm" onClick={onRefine}>
            Refine
          </Button>
          <Button variant="primary" size="sm" onClick={onTryAgain}>
            Try again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
