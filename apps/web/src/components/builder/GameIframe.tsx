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
      <div className="flex h-full w-full items-center justify-center bg-gray-950 text-gray-600">
        <p className="text-sm">Game will appear here</p>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={injectWrapper(code)}
      sandbox="allow-scripts"
      className="h-full w-full border-0"
      title="Game preview"
    />
  );
}
