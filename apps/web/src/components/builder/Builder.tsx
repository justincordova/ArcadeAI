import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useStreamedGeneration } from "../../hooks/useStreamedGeneration.js";
import { GameIframe } from "./GameIframe.js";
import { StatusOverlay } from "./StatusOverlay.js";
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
}

export function Builder({ initialCode = "", initialMessages = [] }: BuilderProps) {
  const { status, code, error, start, stop } = useStreamedGeneration();
  const [prompt, setPrompt] = useState("");
  const isStreaming = status === "streaming";
  const displayCode = code || initialCode;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isStreaming) return;
    start(trimmed);
    setPrompt("");
  }

  return (
    <div className="flex h-[calc(100vh-53px)] overflow-hidden">
      {/* Left panel — chat */}
      <div className="flex w-[35%] min-w-[280px] flex-col border-r border-gray-800 bg-gray-900">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
          <Link to="/" className="text-xs text-gray-500 hover:text-gray-300">
            ← Dashboard
          </Link>
        </div>

        {/* Message log */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {initialMessages.map((msg) => (
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
                Generating…
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

        {/* Prompt input */}
        <form onSubmit={handleSubmit} className="border-t border-gray-800 p-4">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            disabled={isStreaming}
            rows={3}
            placeholder="Describe the game you want to build…"
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-gray-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isStreaming || !prompt.trim()}
            className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStreaming ? "Generating…" : "Generate"}
          </button>
        </form>
      </div>

      {/* Right panel — game iframe */}
      <div className="relative flex-1 bg-gray-950">
        <GameIframe code={displayCode || null} />
        <StatusOverlay visible={isStreaming} />
        <StopButton visible={isStreaming} onStop={stop} />
      </div>
    </div>
  );
}
