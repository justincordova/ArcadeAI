import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStreamedGeneration } from "@/hooks/useStreamedGeneration.js";
import { useStreamedRefinement } from "@/hooks/useStreamedRefinement.js";
import { useThumbnailUploader } from "@/hooks/useThumbnailUploader.js";
import { GAMES_QUERY_KEY, undoRefinement } from "@/lib/api/games.js";
import { captureThumbnailWhenReady } from "@/lib/capture-thumbnail.js";
import { BuilderLayout } from "./BuilderLayout.js";
import type { Message } from "./MessageBubble.js";
import { RepairController, type RepairStatus } from "./RepairController.js";
import type { OverlayStatus } from "./StatusOverlay.js";

interface BuilderProps {
  initialCode?: string;
  initialMessages?: Message[];
  gameId?: string | null;
  initialPrompt?: string;
  /**
   * True when /api/games/:id reports inProgress = true — a generation
   * is running server-side but was started elsewhere (e.g. user
   * submitted on /game/new, then navigated to dashboard, then came
   * back to /game/:id mid-stream). The Builder shows its standard
   * streaming overlay/indicator until the polled query refetches a
   * non-empty currentCode.
   */
  externalStreaming?: boolean;
  /**
   * Whether the last refinement/repair can be undone (from
   * GET /api/games/:id). Enables the single-level Undo control. Only
   * meaningful in the refinement (existing-game) flow.
   */
  canUndo?: boolean;
}

// Builder for /game/new — first generation only
function GenerationBuilder({
  initialCode = "",
  initialMessages = [],
  initialPrompt = "",
}: BuilderProps) {
  const { status, gameId, code, error, start, stop, attachIframe } = useStreamedGeneration();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [reloadKey, setReloadKey] = useState(0);
  const isStreaming = status === "streaming";
  const displayCode = code || initialCode;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Memoize with empty deps — the function only assigns refs and calls
  // attachIframe (which is itself a stable useCallback). Without memoization
  // this changed identity every render, and GameIframe's ref-attach effect
  // ran cleanup+setup at ~10 Hz during streaming. That cleanup fires
  // onIframeReady(null), which can race with the thumbnail-polling logic
  // in useStreamedGeneration.onDone.
  const handleIframeReady = useCallback(
    (el: HTMLIFrameElement | null) => {
      iframeRef.current = el;
      attachIframe(el);
    },
    [attachIframe]
  );

  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isStreaming) return;
    start(trimmed);
    setPrompt("");
  }

  const handleThumbnail = useThumbnailUploader();

  return (
    <BuilderLayout
      messages={initialMessages}
      isStreaming={isStreaming}
      stoppable={isStreaming}
      displayCode={displayCode}
      streamingCode={code}
      error={error}
      prompt={prompt}
      setPrompt={setPrompt}
      onSubmit={handleSubmit}
      onStop={stop}
      textareaRef={textareaRef}
      iframeRef={iframeRef}
      gameId={gameId}
      onIframeReady={handleIframeReady}
      onThumbnail={handleThumbnail}
      reloadKey={reloadKey}
      onRestart={() => setReloadKey((n) => n + 1)}
      streamLabel="Generating..."
      submitLabel="Generate"
    />
  );
}

// Builder for /game/:id — refinement mode
function RefinementBuilder({
  initialCode = "",
  initialMessages = [],
  gameId,
  externalStreaming = false,
  canUndo = false,
}: BuilderProps & { gameId: string }) {
  const queryClient = useQueryClient();
  const { status, streamingCode, finalCode, error, refine, stop, attachIframe } =
    useStreamedRefinement(gameId);
  const [prompt, setPrompt] = useState("");
  const [localMessages, setLocalMessages] = useState<Message[]>(initialMessages);
  const [repairedCode, setRepairedCode] = useState<string | null>(null);
  const [refineTrigger, setRefineTrigger] = useState(0);
  const [repairStatus, setRepairStatus] = useState<RepairStatus>("idle");
  const [reloadKey, setReloadKey] = useState(0);
  // Snapshot of the code as it was when the most recent refinement
  // fired. The DiffViewer uses this against finalCode to render the
  // before/after. Cleared when the parent's `["game", id]` query
  // refetches and replaces initialMessages — at that point the diff
  // is "stale" (history) and we drop the live-diff treatment.
  const [previousCodeSnapshot, setPreviousCodeSnapshot] = useState<string | null>(null);
  // Treat the page as streaming whether the user kicked off a local
  // refinement or the server is finishing a generation started on
  // /game/new. The local hook covers the first case; externalStreaming
  // (polled from the GET /api/games/:id route) covers the second.
  const isStreaming = status === "streaming" || externalStreaming;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // See GenerationBuilder.handleIframeReady — memoized to prevent the
  // child effect from churning at ~10 Hz during streaming.
  const handleIframeReady = useCallback(
    (el: HTMLIFrameElement | null) => {
      iframeRef.current = el;
      attachIframe(el);
    },
    [attachIframe]
  );

  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "streaming" && status === "idle") {
      queryClient.invalidateQueries({ queryKey: ["game", gameId] });
    }
    prevStatus.current = status;
  }, [status, gameId, queryClient]);

  useEffect(() => {
    setLocalMessages(initialMessages);
    // Note: we intentionally don't clear previousCodeSnapshot here.
    // The server emits `done` before the diff summary completes, which
    // triggers a refetch (refreshing initialMessages). If we cleared
    // the snapshot here, the subsequent summary refetch would arrive
    // without a before-snapshot in scope and the DiffViewer would
    // never render. The snapshot is reset on the next user submit
    // (handleSubmit) — the only point where "previous code" semantically
    // becomes stale.
  }, [initialMessages]);

  const displayCode = streamingCode || repairedCode || finalCode || initialCode;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  // Shared by the prompt form and the repair-fallback "Try again" action.
  // Every refinement turn MUST go through this path: skipping the state
  // resets (as the old onTryAgain did by calling refine() directly) left a
  // stale `repairedCode` outranking the fresh finalCode in the displayCode
  // precedence — the preview showed the old game while the server had saved
  // the new one — and left `previousCodeSnapshot` pointing at the previous
  // turn's baseline, rendering the DiffViewer against the wrong "before".
  function submitRefinement(text: string) {
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      kind: "feedback",
      content: text,
      createdAt: Date.now(),
    };
    setLocalMessages((prev) => [...prev, optimisticMsg]);

    // Capture the pre-refinement code for the DiffViewer. `repairedCode` is
    // by construction the most recent code when set (an auto-repair or an
    // undo landed after the last refinement stream), then the last streamed
    // `finalCode`, then `initialCode` (the server-loaded snapshot). Skipping
    // repairedCode here would diff the next refinement against a stale
    // baseline — e.g. the pre-undo code the user just discarded.
    setPreviousCodeSnapshot(repairedCode ?? finalCode ?? initialCode);

    // Drop any prior repaired code. It sits ahead of finalCode in the
    // displayCode precedence, so leaving it set would mask the result of
    // this (and every subsequent) refinement with the stale repaired game.
    setRepairedCode(null);

    setRefineTrigger((n) => n + 1);
    refine(text);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isStreaming) return;
    submitRefinement(trimmed);
    setPrompt("");
  }

  const handleThumbnail = useThumbnailUploader();

  // Cancel handle for the post-repair thumbnail capture — cancelled on
  // unmount so no timer/listener outlives the component. (The previous bare
  // setTimeout(500) was never cleaned up AND raced the iframe reloading its
  // srcDoc with the repaired code — capturing the old canvas or nothing.)
  const cancelRepairCaptureRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      cancelRepairCaptureRef.current?.();
      cancelRepairCaptureRef.current = null;
    };
  }, []);

  function handleRepaired(code: string) {
    setRepairedCode(code);
    cancelRepairCaptureRef.current?.();
    cancelRepairCaptureRef.current = captureThumbnailWhenReady(() => iframeRef.current);
    queryClient.invalidateQueries({ queryKey: ["game", gameId] });
  }

  // Single-level undo. `canUndo` is the server's authoritative flag (from
  // GET /api/games/:id); it re-syncs whenever the ["game", id] query refetches
  // — which the status-change effect above already triggers after a refinement
  // completes, and which handleUndo triggers after consuming the undo point.
  // We mirror it into local state only so the button can flip to disabled
  // immediately on click (optimistic), before the refetch confirms.
  const [canUndoLocal, setCanUndoLocal] = useState(canUndo);
  useEffect(() => {
    setCanUndoLocal(canUndo);
  }, [canUndo]);

  const [undoing, setUndoing] = useState(false);
  function handleUndo() {
    if (undoing || !canUndoLocal) return;
    setUndoing(true);
    setCanUndoLocal(false); // optimistic — refetch reconfirms
    undoRefinement(gameId)
      .then((res) => {
        // Override the displayed code with the restored version (repairedCode
        // sits atop the displayCode precedence) and remount the preview.
        setRepairedCode(res.currentCode);
        setReloadKey((n) => n + 1);
        queryClient.invalidateQueries({ queryKey: ["game", gameId] });
        queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY });
      })
      .catch((err) => {
        // 409 = nothing to undo (slot already consumed). The flag is already
        // optimistically false; the refetch will reconfirm server truth.
        console.warn("[undo]", err);
        queryClient.invalidateQueries({ queryKey: ["game", gameId] });
      })
      .finally(() => setUndoing(false));
  }

  function focusPromptInput() {
    textareaRef.current?.focus();
  }

  const overlayStatus: OverlayStatus =
    repairStatus === "repairing" ? "repairing" : isStreaming ? "generating" : "idle";

  // Mid-generation revisit: the user submitted on /game/new, navigated
  // away, then opened the game while it's still generating. Show the
  // same experience as the initial GenerationBuilder — "Generating..."
  // label and a clean chat panel that doesn't surface the prompt as if
  // it were a refinement turn.
  const isRevisitMidGeneration = externalStreaming && !initialCode;
  const streamLabel = isRevisitMidGeneration ? "Generating..." : "Refining...";
  const visibleMessages = isRevisitMidGeneration
    ? localMessages.filter((m) => m.kind !== "prompt")
    : localMessages;

  return (
    <RepairController
      gameId={gameId}
      currentCode={displayCode}
      iframeRef={iframeRef}
      onRepaired={handleRepaired}
      onTryAgain={() => {
        const original = initialMessages.find((m) => m.kind === "prompt")?.content ?? "";
        if (original && !isStreaming) submitRefinement(original);
      }}
      onRefine={focusPromptInput}
      resetTrigger={refineTrigger}
      onStatusChange={setRepairStatus}
    >
      <BuilderLayout
        messages={visibleMessages}
        isStreaming={isStreaming}
        stoppable={status === "streaming"}
        overlayStatus={overlayStatus}
        displayCode={displayCode}
        streamingCode={streamingCode}
        error={error}
        prompt={prompt}
        setPrompt={setPrompt}
        onSubmit={handleSubmit}
        onStop={stop}
        textareaRef={textareaRef}
        iframeRef={iframeRef}
        gameId={gameId}
        onIframeReady={handleIframeReady}
        onThumbnail={handleThumbnail}
        reloadKey={reloadKey}
        onRestart={() => setReloadKey((n) => n + 1)}
        onUndo={handleUndo}
        canUndo={canUndoLocal}
        undoing={undoing}
        diffPair={
          // Only render the inline diff once streaming has settled into
          // a finalCode and we still hold the before-snapshot.
          previousCodeSnapshot !== null && finalCode !== null && !isStreaming
            ? { previous: previousCodeSnapshot, next: finalCode }
            : null
        }
        streamLabel={streamLabel}
        submitLabel="Refine"
      />
    </RepairController>
  );
}

export function Builder({
  initialCode = "",
  initialMessages = [],
  gameId,
  initialPrompt,
  externalStreaming = false,
  canUndo = false,
}: BuilderProps) {
  if (gameId) {
    return (
      <RefinementBuilder
        initialCode={initialCode}
        initialMessages={initialMessages}
        gameId={gameId}
        externalStreaming={externalStreaming}
        canUndo={canUndo}
      />
    );
  }
  return (
    <GenerationBuilder
      initialCode={initialCode}
      initialMessages={initialMessages}
      initialPrompt={initialPrompt}
    />
  );
}
