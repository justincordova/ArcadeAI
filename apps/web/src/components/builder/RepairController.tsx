import { useCallback, useEffect, useRef, useState } from "react";
import { ConcurrencyError, useStreamedRepair } from "../../hooks/useStreamedRepair.js";
import { RepairFallbackDialog } from "./RepairFallbackDialog.js";

interface GameError {
  message: string;
  stack?: string;
}

export type RepairStatus = "idle" | "repairing" | "fallback";

interface RepairControllerProps {
  gameId: string;
  currentCode: string;
  originalPrompt: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Called with the repaired code on a successful repair */
  onRepaired: (code: string) => void;
  /** Called when the user clicks "Try again" from the fallback dialog */
  onTryAgain: () => void;
  /** Called when the user clicks "Refine" from the fallback dialog */
  onRefine: () => void;
  /** Called when a new generation or refinement starts — resets attempt counter */
  resetTrigger?: number;
  children: React.ReactNode;
}

/**
 * Wraps the builder right panel to handle the auto-repair lifecycle:
 * 1. Listens for game-error postMessages from the iframe.
 * 2. Auto-triggers up to 2 repair attempts via POST /api/games/:id/repair.
 * 3. After 2 failed attempts, opens the fallback dialog.
 */
export function RepairController({
  gameId,
  currentCode,
  iframeRef,
  onRepaired,
  onTryAgain,
  onRefine,
  resetTrigger,
  children,
}: RepairControllerProps) {
  const [repairAttempt, setRepairAttempt] = useState(0);
  const [repairStatus, setRepairStatus] = useState<RepairStatus>("idle");
  const [lastError, setLastError] = useState<GameError | null>(null);
  const [brokenCode, setBrokenCode] = useState("");
  const repairStatusRef = useRef<RepairStatus>("idle");
  repairStatusRef.current = repairStatus;

  const repair = useStreamedRepair(gameId);

  // Reset attempt counter when a new generation/refinement is kicked off
  useEffect(() => {
    if (resetTrigger !== undefined) {
      setRepairAttempt(0);
      setRepairStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTrigger]);

  // When repair stream finishes successfully, notify parent
  const prevRepairStatus = useRef(repair.status);
  useEffect(() => {
    if (prevRepairStatus.current === "streaming" && repair.status === "idle") {
      if (repair.code) {
        onRepaired(repair.code);
      }
      setRepairStatus("idle");
    } else if (prevRepairStatus.current === "streaming" && repair.status === "error") {
      // Stream error — keep repairAttempt as-is; the iframe still has broken
      // code so will re-throw, advancing the attempt counter then.
      setRepairStatus("idle");
    }
    prevRepairStatus.current = repair.status;
  }, [repair.status, repair.code, onRepaired]);

  const handleGameError = useCallback(
    (err: GameError) => {
      if (repairStatusRef.current !== "idle") return;

      setBrokenCode(currentCode);
      setLastError(err);

      setRepairAttempt((prev) => {
        const next = prev + 1;
        if (next <= 2) {
          setRepairStatus("repairing");
          repair.start({ error: err });
        } else {
          setRepairStatus("fallback");
        }
        return next;
      });
    },
    [currentCode, repair]
  );

  // Register window message listener for game-error events
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; message?: unknown; stack?: unknown };
      if (!data || data.type !== "game-error") return;
      // Filter to only messages from our iframe if we have a ref
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;

      handleGameError({
        message: String(data.message ?? "unknown error"),
        stack: typeof data.stack === "string" ? data.stack : undefined,
      });
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [iframeRef, handleGameError]);

  function handleTryAgain() {
    setRepairAttempt(0);
    setRepairStatus("idle");
    onTryAgain();
  }

  function handleRefine() {
    setRepairAttempt(0);
    setRepairStatus("idle");
    onRefine();
  }

  function handleClose() {
    setRepairStatus("idle");
  }

  return (
    <>
      {children}
      {lastError && (
        <RepairFallbackDialog
          open={repairStatus === "fallback"}
          onClose={handleClose}
          error={lastError}
          brokenCode={brokenCode}
          onTryAgain={handleTryAgain}
          onRefine={handleRefine}
        />
      )}
    </>
  );
}

export type { RepairStatus as RepairControllerStatus };
