import { useEffect, useRef } from "react";
import { injectWrapper } from "../../lib/iframe-wrapper.js";

interface GameIframeProps {
  code: string | null;
}

export function GameIframe({ code }: GameIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // Only accept messages from our own iframe — filter out anything from
      // extensions, other iframes, or unrelated windows.
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "game-error") {
        console.error("[game-error]", e.data.message, e.data.stack);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

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
