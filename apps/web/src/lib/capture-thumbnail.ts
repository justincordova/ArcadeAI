/**
 * Ask a (possibly not-yet-mounted) game iframe to capture its thumbnail
 * once it has actually painted a frame.
 *
 * The naive approach — `setTimeout(500)` then postMessage — is the exact
 * failure mode the generation flow was hardened against: during a
 * refinement the iframe is UNMOUNTED (GameIframe shows the placeholder
 * while streaming), and on `done` a fresh iframe must mount, parse its
 * whole srcDoc, and run the wrapper script before it can even receive
 * `capture-thumbnail`. On a slow machine at +500ms either the message is
 * silently dropped (no listener yet → stale thumbnail persists) or an
 * unpainted canvas is captured (blank/black thumbnail overwrites a good
 * one).
 *
 * Sequence, mirroring useStreamedGeneration's inline choreography:
 *   1. Poll for the iframe ref to populate (React commits within a tick).
 *   2. Wait for the iframe's `load` event so the wrapper script is
 *      registered (with a fallback in case load fired before we attached).
 *   3. Wait for the wrapper's `{type:'rendered'}` double-rAF paint signal,
 *      source-checked against this iframe's contentWindow so another frame
 *      can't spoof it — with a timeout fallback for games whose first
 *      frame isn't rAF-driven.
 *   4. postMessage('capture-thumbnail'); the iframe responds with a
 *      `thumbnail` message that GameIframe's listener forwards to
 *      postThumbnail.
 *
 * (useStreamedGeneration keeps its own inline variant because its capture
 * is interleaved with navigation timing; converging them is a refactor,
 * not a fix.)
 *
 * Returns a cancel() that tears down every timer and listener — call it on
 * unmount and before starting a new capture.
 */
export function captureThumbnailWhenReady(getIframe: () => HTMLIFrameElement | null): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let cancelled = false;
  let removeRendered: (() => void) | null = null;
  let detachLoad: (() => void) | null = null;

  const schedule = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  // Max time to wait for the iframe to mount before giving up entirely.
  const MOUNT_WAIT_MS = 3000;
  const MOUNT_POLL_MS = 50;
  // In case `load` fired between the React commit and our listener attach.
  const LOAD_FALLBACK_MS = 1500;
  // Max time to wait for the `rendered` paint signal before capturing anyway.
  const RENDERED_FALLBACK_MS = 1200;

  const capture = () => {
    const live = getIframe();
    if (!cancelled && live?.contentWindow) {
      live.contentWindow.postMessage({ type: "capture-thumbnail" }, "*");
    }
  };

  const armOnLoad = (iframe: HTMLIFrameElement) => {
    let started = false;
    const begin = () => {
      if (started || cancelled) return;
      started = true;
      detachLoad?.();
      detachLoad = null;

      // Latch so the `rendered` signal and the fallback can't both fire.
      let captured = false;
      const fire = () => {
        if (captured || cancelled) return;
        captured = true;
        removeRendered?.();
        removeRendered = null;
        capture();
      };

      const onRendered = (e: MessageEvent) => {
        if (e.source !== getIframe()?.contentWindow) return;
        if ((e.data as { type?: string } | null)?.type === "rendered") fire();
      };
      window.addEventListener("message", onRendered);
      removeRendered = () => window.removeEventListener("message", onRendered);

      schedule(fire, RENDERED_FALLBACK_MS);
    };
    const onLoad = () => begin();
    iframe.addEventListener("load", onLoad);
    detachLoad = () => iframe.removeEventListener("load", onLoad);
    schedule(begin, LOAD_FALLBACK_MS);
  };

  const startedAt = Date.now();
  const waitForIframe = () => {
    if (cancelled) return;
    const iframe = getIframe();
    if (iframe) {
      armOnLoad(iframe);
      return;
    }
    if (Date.now() - startedAt > MOUNT_WAIT_MS) return; // never mounted — skip capture
    schedule(waitForIframe, MOUNT_POLL_MS);
  };
  waitForIframe();

  return () => {
    cancelled = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    removeRendered?.();
    removeRendered = null;
    detachLoad?.();
    detachLoad = null;
  };
}
