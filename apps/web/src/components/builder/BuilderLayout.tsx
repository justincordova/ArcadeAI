// Presentational shell for the builder: the two-pane chat + preview layout,
// its mobile single-pane tab switcher, the prompt input, and the resize
// splitter. All state lives in the parent (GenerationBuilder /
// RefinementBuilder in Builder.tsx); this component only renders props and
// raises callbacks — keeping the streaming/optimistic logic out of the view.

import { Link } from "@tanstack/react-router";
import { ChevronLeft, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { getMissingKeyError, useConfig } from "@/hooks/useConfig.js";
import { useMediaQuery } from "@/hooks/useMediaQuery.js";
import { useSession } from "@/hooks/useSession.js";
import { formatCostLine } from "@/lib/cost-line.js";
import { ChatEmptyState } from "./ChatEmptyState.js";
import { DiffViewer } from "./DiffViewer.js";
import { ErrorBanner } from "./ErrorBanner.js";
import { GameIframe } from "./GameIframe.js";
import { type Message, MessageBubble } from "./MessageBubble.js";
import { PreviewControls } from "./PreviewControls.js";
import { ShareButton } from "./ShareButton.js";
import { type OverlayStatus, StatusOverlay } from "./StatusOverlay.js";
import { StreamingCodePreview } from "./StreamingCodePreview.js";
import { StreamingIndicator } from "./StreamingIndicator.js";
import { SIDEBAR_MAX, SIDEBAR_MIN, useResizableSidebar } from "./useResizableSidebar.js";

export interface BuilderLayoutProps {
  messages: Message[];
  isStreaming: boolean;
  /**
   * Whether the Stop button / Esc shortcut can actually stop anything.
   * False when `isStreaming` is driven only by `externalStreaming` (a
   * server-side generation started elsewhere): the local hook's stop()
   * only aborts a local fetch that doesn't exist in that state, so
   * rendering the control would present a dead button.
   */
  stoppable: boolean;
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
  /** Single-level undo handler. Omitted in the generation flow. */
  onUndo?: () => void;
  /** Whether an undo point exists (drives Undo button visibility/enabled). */
  canUndo?: boolean;
  /** True while an undo request is in flight. */
  undoing?: boolean;
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

export function BuilderLayout({
  messages,
  isStreaming,
  stoppable,
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
  onUndo,
  canUndo = false,
  undoing = false,
  diffPair,
  streamLabel,
  submitLabel,
}: BuilderLayoutProps) {
  const resolvedOverlay: OverlayStatus = overlayStatus ?? (isStreaming ? "generating" : "idle");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNewGame = submitLabel === "Generate";

  // Screen-reader narration for the stream lifecycle.
  //
  // StreamingIndicator and StatusOverlay carry this state visually, but both
  // mount and unmount with it — and a live region inserted at the same moment
  // as its own text is announced unreliably. Worse, nothing marked the *end*
  // of a stream: the indicator simply disappeared, so a non-sighted user got
  // no signal that the game was ready. This region stays mounted for the life
  // of the builder and only its text changes, which is the shape assistive
  // tech actually reacts to.
  const [announcement, setAnnouncement] = useState("");
  const prevOverlay = useRef<OverlayStatus>("idle");
  useEffect(() => {
    const prev = prevOverlay.current;
    prevOverlay.current = resolvedOverlay;
    if (prev === resolvedOverlay) return;

    if (resolvedOverlay === "generating") {
      setAnnouncement(streamLabel);
    } else if (resolvedOverlay === "repairing") {
      setAnnouncement("Detected an error in the game. Fixing it automatically.");
    } else if (prev !== "idle") {
      // A failed stream is already announced by ErrorBanner's role="alert";
      // repeating it here would double up.
      setAnnouncement(error ? "" : isNewGame ? "Game ready." : "Update applied.");
    }
  }, [resolvedOverlay, streamLabel, error, isNewGame]);
  const { data: config } = useConfig();
  const missingKeyError = getMissingKeyError(config);
  const { data: me } = useSession();
  const {
    width: sidebarWidth,
    resizing,
    startResize,
    resetWidth,
    nudgeWidth,
  } = useResizableSidebar();

  // Below the tablet breakpoint the two panes can't sit side by side (a
  // 280px-min sidebar leaves almost nothing for the preview), so we collapse
  // to a single pane with a Chat | Preview switcher. Default to Chat while
  // there's nothing to preview yet.
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");

  const costLine = formatCostLine(me, submitLabel, isNewGame);

  // Auto-scroll to bottom when messages change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — scroll on messages or streaming state change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Global Esc → stop streaming (works even when textarea isn't focused)
  useEffect(() => {
    if (!isStreaming || !stoppable) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onStop();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isStreaming, stoppable, onStop]);

  // On mobile, reveal the result: when a stream starts, switch to Chat so the
  // user watches progress; when it finishes with code, switch to Preview.
  useEffect(() => {
    if (!isMobile) return;
    if (isStreaming) setMobileTab("chat");
    else if (displayCode) setMobileTab("preview");
  }, [isMobile, isStreaming, displayCode]);

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
        flexDirection: isMobile ? "column" : "row",
        height: "calc(100vh - var(--layout-topbar-h))",
        overflow: "hidden",
        background: "var(--color-bg)",
      }}
    >
      {/* ── Mobile tab switcher: only one pane fits on a phone ── */}
      {isMobile && (
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: 4,
            flexShrink: 0,
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {(["chat", "preview"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              aria-pressed={mobileTab === tab}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 8,
                border: "none",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "all 0.15s",
                background: mobileTab === tab ? "var(--gradient-brand-soft)" : "transparent",
                color: mobileTab === tab ? "var(--color-text-primary)" : "var(--color-text-muted)",
              }}
            >
              {tab === "chat" ? (isNewGame ? "New Game" : "Refine") : "Preview"}
            </button>
          ))}
        </div>
      )}

      {/* ── Left panel: chat ── */}
      <div
        style={{
          width: isMobile ? "100%" : sidebarWidth,
          display: isMobile && mobileTab !== "chat" ? "none" : "flex",
          flexDirection: "column",
          background: "var(--color-surface)",
          borderRight: isMobile ? "none" : "1px solid var(--color-border)",
          flexShrink: isMobile ? 1 : 0,
          flex: isMobile ? 1 : undefined,
          minHeight: 0,
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
            <ChatEmptyState
              missingKeyError={missingKeyError}
              isStreaming={isStreaming}
              suggestions={SUGGESTIONS}
              onSuggestionClick={handleSuggestionClick}
            />
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
          {/* Hide the live source panel when there's nothing local to show
              (e.g. resumed-stream view where the bytes are arriving
              server-side only, not in this component's state). The
              indicator above still communicates that work is happening. */}
          {isStreaming && streamingCode && <StreamingCodePreview code={streamingCode} />}

          {error && <ErrorBanner message={error} />}

          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {announcement}
          </p>

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
          {/* The textarea keeps `outline: none` because the focus indicator
              belongs on this wrapper — the textarea is borderless and inset,
              so outlining it would draw a ring inside the visible control.
              The previous treatment was a 1px border tint at 40% alpha,
              which is a colour-only change too faint to satisfy WCAG 2.4.11
              on the app's primary input. Now the border goes solid accent
              and picks up a 3px halo. */}
          <div
            style={{
              position: "relative",
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-raised)",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
            onFocusCapture={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              el.style.borderColor = "var(--color-accent-primary)";
              el.style.boxShadow = "0 0 0 3px rgba(255,62,165,0.22)";
            }}
            onBlurCapture={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              el.style.borderColor = "var(--color-border)";
              el.style.boxShadow = "none";
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
                // Ignore the Enter that confirms an IME candidate (CJK and
                // other composing input methods). Without this guard the
                // in-progress composition is submitted as the prompt and the
                // composition is aborted mid-word. cmd/ctrl+enter above is an
                // explicit force-submit gesture and does not conflict.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSubmit(e as unknown as React.FormEvent);
                  return;
                }
                if (e.key === "Escape" && isStreaming && stoppable) {
                  e.preventDefault();
                  onStop();
                }
              }}
              disabled={isStreaming || Boolean(missingKeyError)}
              rows={3}
              // Placeholders are not accessible names — they vanish on the
              // first keystroke, so a screen-reader user who navigates back
              // to a partly-typed prompt hears an unlabelled edit field.
              aria-label={
                submitLabel === "Refine"
                  ? "Describe a change to this game"
                  : "Describe the game you want to build"
              }
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
                {isStreaming
                  ? stoppable
                    ? `${streamLabel} · esc to stop`
                    : streamLabel
                  : (costLine ?? "⌘↵ to send")}
              </span>
              {isStreaming && stoppable ? (
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
                  aria-label="Send"
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
          // Splitter semantics so screen readers announce it as a resizable
          // separator with its current width, and arrow keys resize it —
          // previously the handle was focusable but drag-only (mouse). Up/Right
          // widen the sidebar, Down/Left narrow it, Home/End jump to the
          // bounds, and double-click / (implicit) Enter resets.
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          onMouseDown={(e) => {
            e.preventDefault();
            startResize();
          }}
          onDoubleClick={resetWidth}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              nudgeWidth(1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              nudgeWidth(-1);
            } else if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              resetWidth();
            }
          }}
          style={{
            // The splitter is meaningless when the panes are stacked into
            // tabs, so it's removed on mobile.
            display: isMobile ? "none" : "block",
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
          minHeight: 0,
          position: "relative",
          display: isMobile && mobileTab !== "preview" ? "none" : "flex",
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
                background:
                  displayCode && !isStreaming ? "var(--color-success)" : "var(--color-text-muted)",
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
              {displayCode && !isStreaming ? "Live Preview" : "Preview"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {displayCode && (
              <PreviewControls
                iframeRef={iframeRef}
                onRestart={onRestart}
                disabled={isStreaming}
                onUndo={onUndo}
                undoDisabled={!canUndo || undoing}
              />
            )}
            {/* Held back only during a FIRST generation. There, gameId arrives
                on the mid-stream `meta` frame, so mounting fired a
                GET /api/games/:id during the stream and seeded the
                ["game", id] cache with { currentCode: "", inProgress: true };
                onDone then navigates to /game/$id, which reads that snapshot
                and shows the "Generating..." overlay for a cycle on a game
                that just finished. A game mid-generation can't be published
                anyway.

                On an existing game the id is known up front and the cache is
                already warm, so gating on isStreaming there would only make
                the control unmount and remount on every refinement turn and
                every auto-repair. */}
            {gameId && (!isNewGame || !isStreaming) && <ShareButton gameId={gameId} />}
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
            isStreaming={isStreaming}
          />
          <StatusOverlay status={resolvedOverlay} />
        </div>
      </div>
    </div>
  );
}
