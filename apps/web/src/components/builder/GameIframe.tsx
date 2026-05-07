import { useEffect, useRef } from "react";
import { injectWrapper } from "../../lib/iframe-wrapper.js";

interface GameIframeProps {
  code: string | null;
  gameId?: string | null;
  onIframeReady?: (el: HTMLIFrameElement | null) => void;
  onThumbnail?: (gameId: string, dataUrl: string) => void;
}

export function GameIframe({ code, gameId, onIframeReady, onThumbnail }: GameIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    onIframeReady?.(iframeRef.current);
    return () => onIframeReady?.(null);
  }, [onIframeReady]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;

      if (e.data?.type === "game-error") {
        console.error("[game-error]", e.data.message, e.data.stack);
      } else if (e.data?.type === "thumbnail" && e.data.dataUrl && gameId && onThumbnail) {
        onThumbnail(gameId, e.data.dataUrl);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [gameId, onThumbnail]);

  if (!code) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          width: "100%",
          gap: 16,
          background: "var(--color-bg)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle grid */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(124,58,237,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.04) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            pointerEvents: "none",
          }}
        />
        {/* Center glow */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 400,
            height: 200,
            background: "radial-gradient(ellipse, rgba(124,58,237,0.07) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background:
                "linear-gradient(135deg, rgba(124,58,237,0.1) 0%, rgba(6,182,212,0.1) 100%)",
              border: "1px solid rgba(124,58,237,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="iframe-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.5" />
                </linearGradient>
              </defs>
              <path
                d="M6 14 C6 7 10 4 16 4 C22 4 26 7 26 14"
                stroke="url(#iframe-grad)"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M6 14 L5 26 C5 27.1 5.9 28 7 28 L25 28 C26.1 28 27 27.1 27 26 L26 14"
                stroke="url(#iframe-grad)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <rect
                x="10"
                y="12"
                width="12"
                height="8"
                rx="1.5"
                stroke="url(#iframe-grad)"
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
          </div>
          <p
            style={{
              fontSize: 13,
              color: "var(--color-text-muted)",
              textAlign: "center",
            }}
          >
            Your game will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={injectWrapper(code)}
      sandbox="allow-scripts"
      style={{ width: "100%", height: "100%", border: "none", display: "block" }}
      title="Game preview"
    />
  );
}
