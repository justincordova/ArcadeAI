import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { GAMES_QUERY_KEY, postThumbnail } from "../../lib/api/games.js";
import { injectWrapper } from "../../lib/iframe-wrapper.js";

interface GameIframeProps {
  code: string | null;
  gameId?: string | null;
  onIframeReady?: (el: HTMLIFrameElement | null) => void;
}

export function GameIframe({ code, gameId, onIframeReady }: GameIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const queryClient = useQueryClient();

  // Notify parent of the iframe element when it mounts/unmounts
  useEffect(() => {
    onIframeReady?.(iframeRef.current);
    return () => onIframeReady?.(null);
  }, [onIframeReady]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // Only accept messages from our own iframe
      if (e.source !== iframeRef.current?.contentWindow) return;

      if (e.data?.type === "game-error") {
        console.error("[game-error]", e.data.message, e.data.stack);
      } else if (e.data?.type === "thumbnail" && e.data.dataUrl && gameId) {
        // Upload thumbnail; swallow errors — a failed thumbnail is not user-facing critical
        postThumbnail(gameId, e.data.dataUrl)
          .then(() => {
            queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY });
          })
          .catch((err) => {
            console.warn("[thumbnail] upload failed:", err);
          });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [gameId, queryClient]);

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
