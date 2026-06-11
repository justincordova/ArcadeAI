// Restart + fullscreen controls for the live game preview.
//
// Restart re-mounts the iframe (via reloadKey bump in the parent) which
// throws away game state and re-runs the inline scripts from a fresh
// document — no need to message the game itself.
//
// Fullscreen calls requestFullscreen() on the iframe element. The iframe
// is rendered with allow="fullscreen" so this works inside the sandbox.

import { Maximize2, RotateCcw, Undo2 } from "lucide-react";
import type { RefObject } from "react";

interface PreviewControlsProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onRestart: () => void;
  disabled?: boolean;
  /**
   * Single-level undo of the last refinement. When omitted, no undo button is
   * shown (e.g. on the public play page or before the first refinement).
   */
  onUndo?: () => void;
  /** Disable the undo button (nothing to undo, or an undo is in flight). */
  undoDisabled?: boolean;
}

export function PreviewControls({
  iframeRef,
  onRestart,
  disabled = false,
  onUndo,
  undoDisabled = false,
}: PreviewControlsProps) {
  function handleFullscreen() {
    const el = iframeRef.current;
    if (!el) return;
    if (typeof el.requestFullscreen === "function") {
      el.requestFullscreen().catch(() => {
        /* user cancelled or not allowed; nothing to do */
      });
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {onUndo && (
        <IconButton
          label="Undo last change"
          onClick={onUndo}
          disabled={disabled || undoDisabled}
          icon={<Undo2 size={12} strokeWidth={2} />}
        />
      )}
      <IconButton
        label="Restart game"
        onClick={onRestart}
        disabled={disabled}
        icon={<RotateCcw size={12} strokeWidth={2} />}
      />
      <IconButton
        label="Fullscreen"
        onClick={handleFullscreen}
        disabled={disabled}
        icon={<Maximize2 size={12} strokeWidth={2} />}
      />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: 6,
        border: "1px solid var(--color-border)",
        background: "transparent",
        color: "var(--color-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,62,165,0.4)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
      }}
    >
      {icon}
    </button>
  );
}
