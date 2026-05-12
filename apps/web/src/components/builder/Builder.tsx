import { getMissingKeyError, useConfig } from "@/hooks/useConfig.js";
import { useSession } from "@/hooks/useSession.js";
import { useStreamedGeneration } from "@/hooks/useStreamedGeneration.js";
import { useStreamedRefinement } from "@/hooks/useStreamedRefinement.js";
import { GAMES_QUERY_KEY, postThumbnail } from "@/lib/api/games.js";
import {
  CREDIT_COSTS,
  ENFORCE_LIFETIME_LIMITS_FOR_FREE,
  FREE_TIER_LIFETIME_LIMITS,
} from "@arcadeai/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DiffViewer } from "./DiffViewer.js";
import { ErrorBanner } from "./ErrorBanner.js";
import { GameIframe } from "./GameIframe.js";
import { type Message, MessageBubble } from "./MessageBubble.js";
import { PreviewControls } from "./PreviewControls.js";
import { RepairController, type RepairStatus } from "./RepairController.js";
import { ShareButton } from "./ShareButton.js";
import { type OverlayStatus, StatusOverlay } from "./StatusOverlay.js";
import { StreamingCodePreview } from "./StreamingCodePreview.js";
import { StreamingIndicator } from "./StreamingIndicator.js";

interface BuilderProps {
  initialCode?: string;
  initialMessages?: Message[];
  gameId?: string | null;
  initialPrompt?: string;
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
  const queryClient = useQueryClient();

  function handleIframeReady(el: HTMLIFrameElement | null) {
    iframeRef.current = el;
    attachIframe(el);
  }

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

  // Memoize so GameIframe's message listener doesn't tear down and
  // re-bind on every streaming chunk render. A listener swap during
  // streaming would cause the iframe's `thumbnail` response to land in
  // the gap between unbind and rebind and be dropped.
  const handleThumbnail = useCallback(
    (id: string, dataUrl: string) => {
      postThumbnail(id, dataUrl)
        .then(() => queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY }))
        .catch((err) => console.warn("[thumbnail]", err));
    },
    [queryClient]
  );

  return (
    <BuilderLayout
      messages={initialMessages}
      isStreaming={isStreaming}
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
  const isStreaming = status === "streaming";
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  function handleIframeReady(el: HTMLIFrameElement | null) {
    iframeRef.current = el;
    attachIframe(el);
  }

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isStreaming) return;

    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      kind: "feedback",
      content: trimmed,
      createdAt: Date.now(),
    };
    setLocalMessages((prev) => [...prev, optimisticMsg]);

    // Capture the pre-refinement code for the DiffViewer. Prefer the
    // last-known good `finalCode` (if a previous refinement ran in
    // this same session); otherwise fall back to `initialCode` (the
    // server-loaded snapshot).
    setPreviousCodeSnapshot(finalCode ?? initialCode);

    setRefineTrigger((n) => n + 1);
    refine(trimmed);
    setPrompt("");
  }

  // Same memoization as GenerationBuilder — see comment there.
  const handleThumbnail = useCallback(
    (id: string, dataUrl: string) => {
      postThumbnail(id, dataUrl)
        .then(() => queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY }))
        .catch((err) => console.warn("[thumbnail]", err));
    },
    [queryClient]
  );

  function handleRepaired(code: string) {
    setRepairedCode(code);
    setTimeout(() => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
      }
    }, 500);
    queryClient.invalidateQueries({ queryKey: ["game", gameId] });
  }

  function focusPromptInput() {
    textareaRef.current?.focus();
  }

  const overlayStatus: OverlayStatus =
    repairStatus === "repairing" ? "repairing" : isStreaming ? "generating" : "idle";

  return (
    <RepairController
      gameId={gameId}
      currentCode={displayCode}
      iframeRef={iframeRef}
      onRepaired={handleRepaired}
      onTryAgain={() => {
        const original = initialMessages.find((m) => m.kind === "prompt")?.content ?? "";
        if (original) refine(original);
      }}
      onRefine={focusPromptInput}
      resetTrigger={refineTrigger}
      onStatusChange={setRepairStatus}
    >
      <BuilderLayout
        messages={localMessages}
        isStreaming={isStreaming}
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
        diffPair={
          // Only render the inline diff once streaming has settled into
          // a finalCode and we still hold the before-snapshot.
          previousCodeSnapshot !== null && finalCode !== null && !isStreaming
            ? { previous: previousCodeSnapshot, next: finalCode }
            : null
        }
        streamLabel="Refining..."
        submitLabel="Refine"
      />
    </RepairController>
  );
}

interface BuilderLayoutProps {
  messages: Message[];
  isStreaming: boolean;
  overlayStatus?: OverlayStatus;
  displayCode: string;
  /** In-flight streaming bytes only — drives the StreamingCodePreview. */
  streamingCode: string;
  error: string | null;
  prompt: string;
  setPrompt: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  gameId?: string | null;
  onIframeReady: (el: HTMLIFrameElement | null) => void;
  onThumbnail: (gameId: string, dataUrl: string) => void;
  reloadKey: number;
  onRestart: () => void;
  /**
   * Before/after code for the live (most-recent) refinement turn. When
   * present, the DiffViewer renders under the last `summary` message
   * and lets the user expand a +/− line view. Null for generation flow
   * and for history loaded from the server.
   */
  diffPair?: { previous: string; next: string } | null;
  streamLabel: string;
  submitLabel: string;
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <title>Send</title>
      <path
        d="M1.5 7.5h12M8.5 2.5l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SUGGESTIONS = ["A simple snake game", "Asteroids with power-ups", "Pong with AI opponent"];

const SIDEBAR_WIDTH_KEY = "builder-sidebar-width";
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 340;

function getStoredSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isNaN(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n;
  } catch {}
  return SIDEBAR_DEFAULT;
}

function BuilderLayout({
  messages,
  isStreaming,
  overlayStatus,
  displayCode,
  streamingCode,
  error,
  prompt,
  setPrompt,
  onSubmit,
  onStop,
  textareaRef,
  iframeRef,
  gameId,
  onIframeReady,
  onThumbnail,
  reloadKey,
  onRestart,
  diffPair,
  streamLabel,
  submitLabel,
}: BuilderLayoutProps) {
  const resolvedOverlay: OverlayStatus = overlayStatus ?? (isStreaming ? "generating" : "idle");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNewGame = submitLabel === "Generate";
  const { data: config } = useConfig();
  const missingKeyError = getMissingKeyError(config);
  const { data: me } = useSession();
  const [sidebarWidth, setSidebarWidth] = useState<number>(getStoredSidebarWidth);
  const [resizing, setResizing] = useState(false);
  // Keep the latest width in a ref so the mouseup persister reads the
  // final value without re-binding the listener on every pixel of drag.
  const sidebarWidthRef = useRef(sidebarWidth);
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  // Drag-to-resize the chat sidebar. Mouse-move runs while a drag is active;
  // we attach to window so the cursor can leave the handle without losing
  // the drag. The width is clamped on every move and persisted on release.
  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
      setSidebarWidth(next);
    }
    function onUp() {
      setResizing(false);
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
      } catch {}
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing]);

  // Cost preview text (#44). Free + lifetime cap on shows trial counters;
  // everyone else sees credit cost vs remaining monthly balance. Admin
  // skips this — unlimited credits make the line meaningless.
  const action = isNewGame ? "generation" : "refinement";
  const cost = CREDIT_COSTS[action];
  let costLine: string | null = null;
  if (me && me.tier !== "admin") {
    if (me.tier === "free" && ENFORCE_LIFETIME_LIMITS_FOR_FREE) {
      const used = isNewGame ? me.lifetimeGenerationsUsed : me.lifetimeRefinementsUsed;
      const total = isNewGame
        ? FREE_TIER_LIFETIME_LIMITS.generations
        : FREE_TIER_LIFETIME_LIMITS.refinements;
      const remaining = Math.max(0, total - used);
      costLine = `${submitLabel} (${remaining} of ${total} remaining)`;
    } else {
      costLine = `${submitLabel} (${cost} credits) — you have ${me.creditsRemainingMonthly.toLocaleString()}`;
    }
  }

  // Auto-scroll to bottom when messages change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — scroll on messages or streaming state change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Global Esc → stop streaming (works even when textarea isn't focused)
  useEffect(() => {
    if (!isStreaming) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onStop();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isStreaming, onStop]);

  const canSubmit = !isStreaming && prompt.trim().length > 0 && !missingKeyError;

  function handleSuggestionClick(text: string) {
    // flushSync ensures the state update is committed to the DOM before
    // requestSubmit fires. Without it, the form may read the stale prompt value.
    flushSync(() => {
      setPrompt(text);
    });
    textareaRef.current?.form?.requestSubmit();
  }

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 56px)",
        overflow: "hidden",
        background: "var(--color-bg)",
      }}
    >
      {/* ── Left panel: chat ── */}
      <div
        style={{
          width: sidebarWidth,
          display: "flex",
          flexDirection: "column",
          background: "var(--color-surface)",
          borderRight: "1px solid var(--color-border)",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {/* Panel header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <Link
            to="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--color-text-muted)",
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--color-text-secondary)";
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--color-text-muted)";
            }}
          >
            <ChevronLeft size={12} strokeWidth={1.8} />
            Dashboard
          </Link>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
            }}
          >
            {isNewGame ? "New Game" : "Refine"}
          </span>
        </div>

        {/* Missing key banner */}
        {missingKeyError && (
          <div
            style={{
              margin: "12px 12px 0",
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(245,158,11,0.35)",
              background: "rgba(245,158,11,0.08)",
              fontSize: 12,
              color: "#fbbf24",
              lineHeight: 1.55,
              flexShrink: 0,
            }}
          >
            <strong style={{ display: "block", marginBottom: 3 }}>Setup required</strong>
            {missingKeyError}
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px" }}>
          {messages.length === 0 && !isStreaming && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 12,
                textAlign: "center",
                padding: "0 8px",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background:
                    "linear-gradient(135deg, rgba(255,62,165,0.15) 0%, rgba(76,223,232,0.15) 100%)",
                  border: "1px solid rgba(255,62,165,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path
                    d="M9 2.5v13M2.5 9h13"
                    stroke="url(#builder-plus)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="builder-plus" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#a78bfa" />
                      <stop offset="100%" stopColor="#4cdfe8" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                Describe the game you want to build. Be as specific or vague as you like.
              </p>
              {!missingKeyError && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      disabled={isStreaming}
                      style={{
                        padding: "7px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        background: "transparent",
                        fontSize: 12,
                        color: "var(--color-text-secondary)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                        transition: "all 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background =
                          "var(--color-surface-raised)";
                        (e.currentTarget as HTMLButtonElement).style.borderColor =
                          "rgba(255,62,165,0.3)";
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "var(--color-text-primary)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                        (e.currentTarget as HTMLButtonElement).style.borderColor =
                          "var(--color-border)";
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "var(--color-text-secondary)";
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => {
            const isLastMessage = i === messages.length - 1;
            // Attach the diff viewer under the last `summary` bubble
            // when we still have the live before/after in scope.
            const attachDiff =
              isLastMessage && msg.kind === "summary" && !isStreaming && diffPair !== null;
            return (
              <div key={msg.id}>
                <MessageBubble msg={msg} isLast={isLastMessage && !isStreaming} />
                {attachDiff && diffPair && (
                  <DiffViewer previousCode={diffPair.previous} newCode={diffPair.next} />
                )}
              </div>
            );
          })}

          {isStreaming && <StreamingIndicator label={streamLabel} />}
          {isStreaming && <StreamingCodePreview code={streamingCode} />}

          {error && <ErrorBanner message={error} />}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <form
          onSubmit={onSubmit}
          style={{
            flexShrink: 0,
            padding: 12,
            borderTop: "1px solid var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          <div
            style={{
              position: "relative",
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-raised)",
              transition: "border-color 0.15s",
            }}
            onFocusCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,62,165,0.4)";
            }}
            onBlurCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)";
            }}
          >
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                // cmd/ctrl+enter always submits; plain enter submits unless shift held
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSubmit(e as unknown as React.FormEvent);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e as unknown as React.FormEvent);
                  return;
                }
                if (e.key === "Escape" && isStreaming) {
                  e.preventDefault();
                  onStop();
                }
              }}
              disabled={isStreaming || Boolean(missingKeyError)}
              rows={3}
              placeholder={
                missingKeyError
                  ? "Configure API keys to enable generation..."
                  : submitLabel === "Refine"
                    ? "Describe a change..."
                    : "Describe the game you want to build..."
              }
              style={{
                width: "100%",
                resize: "none",
                border: "none",
                background: "transparent",
                padding: "12px 12px 8px",
                fontSize: 13,
                color: "var(--color-text-primary)",
                fontFamily: "inherit",
                outline: "none",
                lineHeight: 1.5,
                opacity: missingKeyError ? 0.5 : 1,
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px 8px",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "var(--color-text-muted)",
                  letterSpacing: "0.02em",
                }}
              >
                {isStreaming ? `${streamLabel} · esc to stop` : (costLine ?? "⌘↵ to send")}
              </span>
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop generation"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    border: "none",
                    background: "var(--color-danger)",
                    color: "#fff",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    flexShrink: 0,
                  }}
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSubmit}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    border: "none",
                    background: canSubmit
                      ? "linear-gradient(135deg, #ff3ea5 0%, #4cdfe8 100%)"
                      : "var(--color-border)",
                    color: canSubmit ? "#fff" : "var(--color-text-muted)",
                    cursor: canSubmit ? "pointer" : "not-allowed",
                    transition: "all 0.15s",
                    flexShrink: 0,
                  }}
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Drag handle — invisible 6px strip on the right edge that
            shows a tinted line on hover. Pointer events outside the strip
            still work because the strip is absolutely positioned and
            doesn't block sibling content. */}
        <button
          type="button"
          aria-label="Resize chat panel"
          onMouseDown={(e) => {
            e.preventDefault();
            setResizing(true);
          }}
          onDoubleClick={() => {
            setSidebarWidth(SIDEBAR_DEFAULT);
            try {
              localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT));
            } catch {}
          }}
          style={{
            position: "absolute",
            top: 0,
            right: -3,
            bottom: 0,
            width: 6,
            cursor: "col-resize",
            background: resizing ? "rgba(255,62,165,0.4)" : "transparent",
            border: "none",
            padding: 0,
            zIndex: 5,
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => {
            if (!resizing) {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,62,165,0.2)";
            }
          }}
          onMouseLeave={(e) => {
            if (!resizing) {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }
          }}
        />
      </div>

      {/* ── Right panel: game preview ── */}
      <div
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-bg)",
          overflow: "hidden",
        }}
      >
        {/* Preview header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            height: 40,
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: displayCode ? "var(--color-success)" : "var(--color-text-muted)",
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-text-muted)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {displayCode ? "Live Preview" : "Preview"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {displayCode && (
              <PreviewControls iframeRef={iframeRef} onRestart={onRestart} disabled={isStreaming} />
            )}
            {gameId && <ShareButton gameId={gameId} />}
          </div>
        </div>

        {/* Game area */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <GameIframe
            code={displayCode || null}
            gameId={gameId}
            onIframeReady={onIframeReady}
            onThumbnail={onThumbnail}
            reloadKey={reloadKey}
          />
          <StatusOverlay status={resolvedOverlay} />
        </div>
      </div>
    </div>
  );
}

export function Builder({
  initialCode = "",
  initialMessages = [],
  gameId,
  initialPrompt,
}: BuilderProps) {
  if (gameId) {
    return (
      <RefinementBuilder
        initialCode={initialCode}
        initialMessages={initialMessages}
        gameId={gameId}
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
