import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useStreamedGeneration } from "../../hooks/useStreamedGeneration.js";
import { useStreamedRefinement } from "../../hooks/useStreamedRefinement.js";
import { GAMES_QUERY_KEY, postThumbnail } from "../../lib/api/games.js";
import { GameIframe } from "./GameIframe.js";
import { RepairController, type RepairStatus } from "./RepairController.js";
import { type OverlayStatus, StatusOverlay } from "./StatusOverlay.js";
import { StopButton } from "./StopButton.js";

interface Message {
  id: string;
  kind: string;
  content: string;
  createdAt: number;
}

interface BuilderProps {
  initialCode?: string;
  initialMessages?: Message[];
  gameId?: string | null;
}

// Builder for /game/new — first generation only
function GenerationBuilder({ initialCode = "", initialMessages = [] }: BuilderProps) {
  const { status, gameId, code, error, start, stop, attachIframe } = useStreamedGeneration();
  const [prompt, setPrompt] = useState("");
  const isStreaming = status === "streaming";
  const displayCode = code || initialCode;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

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

  function handleThumbnail(id: string, dataUrl: string) {
    postThumbnail(id, dataUrl)
      .then(() => queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY }))
      .catch((err) => console.warn("[thumbnail]", err));
  }

  return (
    <BuilderLayout
      messages={initialMessages}
      isStreaming={isStreaming}
      displayCode={displayCode}
      error={error}
      prompt={prompt}
      setPrompt={setPrompt}
      onSubmit={handleSubmit}
      onStop={stop}
      textareaRef={textareaRef}
      gameId={gameId}
      onIframeReady={attachIframe}
      onThumbnail={handleThumbnail}
      streamLabel="Generating…"
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
  // Increment to signal RepairController to reset its attempt counter
  const [refineTrigger, setRefineTrigger] = useState(0);
  const [repairStatus, setRepairStatus] = useState<RepairStatus>("idle");
  const isStreaming = status === "streaming";
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Combined attach: pass iframe ref to both refinement hook and RepairController
  function handleIframeReady(el: HTMLIFrameElement | null) {
    iframeRef.current = el;
    attachIframe(el);
  }

  // When refine completes, invalidate to reload messages
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "streaming" && status === "idle") {
      queryClient.invalidateQueries({ queryKey: ["game", gameId] });
    }
    prevStatus.current = status;
  }, [status, gameId, queryClient]);

  // Keep local messages in sync with prop updates
  useEffect(() => {
    setLocalMessages(initialMessages);
  }, [initialMessages]);

  // Display priority: live stream > repaired code > last refinement's final code > server-loaded code.
  const displayCode = streamingCode || repairedCode || finalCode || initialCode;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isStreaming) return;

    // Optimistic: add pending feedback message to local state
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      kind: "feedback",
      content: trimmed,
      createdAt: Date.now(),
    };
    setLocalMessages((prev) => [...prev, optimisticMsg]);

    setRefineTrigger((n) => n + 1); // reset repair attempt counter
    refine(trimmed);
    setPrompt("");
  }

  function handleThumbnail(id: string, dataUrl: string) {
    postThumbnail(id, dataUrl)
      .then(() => queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY }))
      .catch((err) => console.warn("[thumbnail]", err));
  }

  function handleRepaired(code: string) {
    setRepairedCode(code);
    // Trigger thumbnail recapture after repair
    setTimeout(() => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
      }
    }, 500);
    // Invalidate game query so the DB-persisted code is in sync
    queryClient.invalidateQueries({ queryKey: ["game", gameId] });
  }

  function focusPromptInput() {
    textareaRef.current?.focus();
  }

  // Repair status takes precedence over refinement streaming so the overlay
  // shows "Detected an error, fixing..." even mid-refinement-bookkeeping.
  const overlayStatus: OverlayStatus =
    repairStatus === "repairing" ? "repairing" : isStreaming ? "generating" : "idle";

  return (
    <RepairController
      gameId={gameId}
      currentCode={displayCode}
      iframeRef={iframeRef}
      onRepaired={handleRepaired}
      onTryAgain={() => {
        // Plan §13 specifies a fresh generation against game.original_prompt.
        // The prototype has no "regenerate against existing game id" endpoint,
        // so we run the original prompt through the refinement pipeline. This
        // produces fresh code from the LLM (charging refinement cost rather
        // than generation cost) — a documented deviation from the plan.
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
        error={error}
        prompt={prompt}
        setPrompt={setPrompt}
        onSubmit={handleSubmit}
        onStop={stop}
        textareaRef={textareaRef}
        gameId={gameId}
        onIframeReady={handleIframeReady}
        onThumbnail={handleThumbnail}
        streamLabel="Refining…"
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
  error: string | null;
  prompt: string;
  setPrompt: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  gameId?: string | null;
  onIframeReady: (el: HTMLIFrameElement | null) => void;
  onThumbnail: (gameId: string, dataUrl: string) => void;
  streamLabel: string;
  submitLabel: string;
}

function BuilderLayout({
  messages,
  isStreaming,
  overlayStatus,
  displayCode,
  error,
  prompt,
  setPrompt,
  onSubmit,
  onStop,
  textareaRef,
  gameId,
  onIframeReady,
  onThumbnail,
  streamLabel,
  submitLabel,
}: BuilderLayoutProps) {
  const resolvedOverlay: OverlayStatus = overlayStatus ?? (isStreaming ? "generating" : "idle");
  return (
    <div className="flex h-[calc(100vh-53px)] overflow-hidden">
      {/* Left panel — chat */}
      <div className="flex w-[35%] min-w-[280px] flex-col border-r border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
          <Link to="/" className="text-xs text-gray-500 hover:text-gray-300">
            ← Dashboard
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.map((msg) => (
            <div key={msg.id} className="mb-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {msg.kind === "prompt" ? "Prompt" : "Feedback"}
              </p>
              <p className="mt-1 text-sm text-gray-200">{msg.content}</p>
            </div>
          ))}
          {isStreaming && (
            <div className="mb-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {streamLabel}
              </p>
              {displayCode && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-400">
                    Show code ({displayCode.length} chars)
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-800 p-2 text-xs text-gray-300">
                    {displayCode.slice(0, 2000)}
                    {displayCode.length > 2000 ? "…" : ""}
                  </pre>
                </details>
              )}
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t border-gray-800 p-4">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e as unknown as React.FormEvent);
              }
            }}
            disabled={isStreaming}
            rows={3}
            placeholder={
              submitLabel === "Refine"
                ? "Describe a change…"
                : "Describe the game you want to build…"
            }
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-gray-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isStreaming || !prompt.trim()}
            className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStreaming ? streamLabel : submitLabel}
          </button>
        </form>
      </div>

      {/* Right panel — game iframe */}
      <div className="relative flex-1 bg-gray-950">
        <GameIframe
          code={displayCode || null}
          gameId={gameId}
          onIframeReady={onIframeReady}
          onThumbnail={onThumbnail}
        />
        <StatusOverlay status={resolvedOverlay} />
        <StopButton visible={resolvedOverlay === "generating"} onStop={onStop} />
      </div>
    </div>
  );
}

export function Builder({ initialCode = "", initialMessages = [], gameId }: BuilderProps) {
  if (gameId) {
    return (
      <RefinementBuilder
        initialCode={initialCode}
        initialMessages={initialMessages}
        gameId={gameId}
      />
    );
  }
  return <GenerationBuilder initialCode={initialCode} initialMessages={initialMessages} />;
}
