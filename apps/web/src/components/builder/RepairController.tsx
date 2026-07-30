import { useCallback, useEffect, useRef, useState } from "react";
import { useStreamedRepair } from "@/hooks/useStreamedRepair.js";
import { RepairFallbackDialog } from "./RepairFallbackDialog.js";

interface GameError {
  message: string;
  stack?: string;
}

export type RepairStatus = "idle" | "repairing" | "fallback";

interface RepairControllerProps {
  gameId: string;
  currentCode: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Called with the repaired code on a successful repair */
  onRepaired: (code: string) => void;
  /** Called when the user clicks "Try again" from the fallback dialog */
  onTryAgain: () => void;
  /** Called when the user clicks "Refine" from the fallback dialog */
  onRefine: () => void;
  /** Called when a new generation or refinement starts — resets attempt counter */
  resetTrigger?: number;
  /**
   * Called whenever the controller's repair status changes. The parent forwards
   * this to BuilderLayout's overlay so "Detected an error, fixing..." is shown
   * during repair. Without this, the repairing status is invisible.
   */
  onStatusChange?: (status: RepairStatus) => void;
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
  onStatusChange,
  children,
}: RepairControllerProps) {
  // repairAttemptRef is the authoritative counter — updated synchronously so
  // rapid back-to-back game-error messages see the correct value without
  // waiting for a re-render.
  const repairAttemptRef = useRef(0);
  const [repairStatus, setRepairStatus] = useState<RepairStatus>("idle");
  const [lastError, setLastError] = useState<GameError | null>(null);
  const [brokenCode, setBrokenCode] = useState("");
  const repairStatusRef = useRef<RepairStatus>("idle");
  repairStatusRef.current = repairStatus;

  const repair = useStreamedRepair(gameId);

  // Set when a reset (new refinement/generation) aborts an in-flight repair.
  // repair.stop() flips repair.status streaming -> idle synchronously, which
  // would otherwise trip the "repair finished successfully" branch below and
  // resurrect the aborted repair's code over the new refinement. This flag
  // lets that effect distinguish an abort from a genuine completion.
  const repairAbortedRef = useRef(false);

  // Notify parent of status changes so the overlay can reflect them.
  useEffect(() => {
    onStatusChange?.(repairStatus);
  }, [repairStatus, onStatusChange]);

  // Reset attempt counter when a new generation/refinement is kicked off.
  // Abort any in-flight repair too: otherwise the background repair stream
  // keeps running, the server's single-stream lock 409s the new refinement,
  // and when the abandoned repair completes it fires onRepaired — masking the
  // refinement with the stale repaired game.
  //
  // Latch on the previous resetTrigger value rather than depending on `repair`:
  // useStreamedRepair returns a fresh object literal every render, so listing
  // it in the deps would re-run this effect on EVERY commit and abort each
  // repair the instant it starts. We only want to act on an actual
  // resetTrigger change, so compare against the previous value via a ref.
  const prevResetTrigger = useRef(resetTrigger);
  // biome-ignore lint/correctness/useExhaustiveDependencies: repair is intentionally excluded — it changes identity every render; the ref latch keys off resetTrigger only
  useEffect(() => {
    if (resetTrigger === undefined || prevResetTrigger.current === resetTrigger) return;
    prevResetTrigger.current = resetTrigger;
    // Only latch the abort flag when a repair is actually in flight. Setting
    // it unconditionally left it stuck true in the common case (a refinement
    // submitted with no repair running): repair.stop() on an already-idle
    // stream produces no streaming -> idle transition, and that transition is
    // the only thing that clears the flag. The next genuinely successful
    // repair then took the abort branch and its code was silently discarded —
    // overlay gone, game still broken, no fallback dialog.
    if (repair.status === "streaming") {
      repairAbortedRef.current = true;
    }
    repair.stop();
    repairAttemptRef.current = 0;
    setRepairStatus("idle");
  }, [resetTrigger]);

  // When repair stream finishes successfully, notify parent
  const prevRepairStatus = useRef(repair.status);
  useEffect(() => {
    if (prevRepairStatus.current === "streaming" && repair.status === "idle") {
      // Skip if this idle transition came from an abort (reset), not a real
      // completion — applying the aborted code would clobber the refinement.
      if (repairAbortedRef.current) {
        repairAbortedRef.current = false;
      } else if (repair.code) {
        onRepaired(repair.code);
      }
      setRepairStatus("idle");
    } else if (prevRepairStatus.current === "streaming" && repair.status === "error") {
      // The repair STREAM failed (402, 409, 500, network) — as opposed to the
      // repair completing with code that still throws.
      //
      // Going idle here relied on the iframe re-throwing to advance the
      // attempt counter. That only holds for an error raised from a live rAF
      // loop; a one-shot error thrown during init fires once, so nothing
      // re-arms and the user is left with the overlay gone, a broken game on
      // screen, and no feedback or path forward. Surface the fallback dialog
      // instead — `lastError` is already set (handleGameError sets it before
      // starting the stream), and the dialog offers Try again / Refine.
      setRepairStatus("fallback");
    }
    prevRepairStatus.current = repair.status;
  }, [repair.status, repair.code, onRepaired]);

  const handleGameError = useCallback(
    (err: GameError) => {
      if (repairStatusRef.current !== "idle") return;

      setBrokenCode(currentCode);
      setLastError(err);

      // Increment the ref synchronously so rapid back-to-back game-error
      // messages (before React re-renders) see the correct count.
      repairAttemptRef.current += 1;
      const next = repairAttemptRef.current;
      if (next <= 2) {
        setRepairStatus("repairing");
        repair.start({ error: err });
      } else {
        setRepairStatus("fallback");
      }
    },
    [currentCode, repair]
  );

  // Register window message listener for game-error events
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; message?: unknown; stack?: unknown };
      if (data?.type !== "game-error") return;
      // Only accept messages that verifiably came from our iframe. The
      // check must fail CLOSED when the ref is null (iframe unmounted,
      // e.g. during streaming): a `iframeRef.current && ...` guard would
      // skip the source check entirely in that state, letting any window
      // holding a reference to this page forge a game-error and trigger a
      // repair stream. A genuine game-error can't arrive without a live
      // iframe anyway.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;

      // Truncate to the server's RepairBody limits (message<=2048, stack<=16384).
      // A generated game can throw an error whose message stringifies a large
      // object, or produce a deep stack — sending it verbatim 400s the repair
      // request and silently drops the user into the fallback dialog without a
      // real attempt. The top of a stack carries the useful frames, so tail-
      // truncation is safe.
      handleGameError({
        message: String(data.message ?? "unknown error").slice(0, 2048),
        stack: typeof data.stack === "string" ? data.stack.slice(0, 16384) : undefined,
      });
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [iframeRef, handleGameError]);

  function handleTryAgain() {
    repairAttemptRef.current = 0;
    setRepairStatus("idle");
    onTryAgain();
  }

  function handleRefine() {
    repairAttemptRef.current = 0;
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
