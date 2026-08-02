import { useEffect, useRef, useState } from "react";

const SIDEBAR_WIDTH_KEY = "builder-sidebar-width";
export const SIDEBAR_MIN = 280;
export const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 340;
/** Pixels moved per arrow-key press when resizing via the keyboard. */
const KEYBOARD_STEP = 16;
/**
 * Room the preview pane must keep. The two-pane layout starts at 769px, so
 * a persisted 640px sidebar would otherwise leave the preview 129px — and
 * the chat pane is `flexShrink: 0`, so it never gives any of it back.
 * Widths are stored in localStorage, so this is reachable simply by
 * dragging wide on a large monitor and later opening a narrow window.
 */
const PREVIEW_MIN = 360;

/** Upper bound that also respects the current viewport, not just the constant. */
export function maxSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_MAX;
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - PREVIEW_MIN));
}

function clampWidth(n: number): number {
  return Math.min(maxSidebarWidth(), Math.max(SIDEBAR_MIN, n));
}

function persistWidth(n: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(n));
  } catch {}
}

function getStoredSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isNaN(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n;
  } catch {}
  return SIDEBAR_DEFAULT;
}

export interface ResizableSidebar {
  /** Current sidebar width in px (clamped to [SIDEBAR_MIN, max]). */
  width: number;
  /**
   * Effective upper bound right now — SIDEBAR_MAX, or less when the
   * viewport can't spare it. Exposed so the splitter's aria-valuemax
   * reports the bound the user can actually reach.
   */
  max: number;
  /** True while a drag is in progress. */
  resizing: boolean;
  /** Begin a drag — wire to the resize handle's onMouseDown. */
  startResize: () => void;
  /** Reset to the default width and persist — wire to onDoubleClick. */
  resetWidth: () => void;
  /**
   * Nudge the width by a fixed step and persist — wire to the handle's
   * onKeyDown (arrow keys) so the splitter is keyboard-operable, not just
   * drag-only. Positive widens the sidebar, negative narrows it.
   */
  nudgeWidth: (direction: 1 | -1) => void;
}

/**
 * Drag-to-resize state for the Builder chat sidebar. Owns the width state, the
 * window-level mousemove/mouseup drag listeners, body cursor/selection styling
 * during a drag, and localStorage persistence on release. Extracted from
 * BuilderLayout verbatim so the presentational component stays focused on
 * markup. Behavior is identical to the previous inline implementation.
 */
export function useResizableSidebar(): ResizableSidebar {
  const [width, setWidth] = useState<number>(getStoredSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const [max, setMax] = useState<number>(SIDEBAR_MAX);

  // Re-clamp when the window changes size. The stored width is validated
  // against the constants at read time, but those say nothing about how
  // much room the current viewport actually has.
  useEffect(() => {
    function onResize() {
      setMax(maxSidebarWidth());
      setWidth((w) => clampWidth(w));
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Keep the latest width in a ref so the mouseup persister reads the final
  // value without re-binding the listener on every pixel of drag.
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  // Mouse-move runs while a drag is active; we attach to window so the cursor
  // can leave the handle without losing the drag. The width is clamped on
  // every move and persisted on release.
  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      setWidth(clampWidth(e.clientX));
    }
    function onUp() {
      setResizing(false);
      persistWidth(widthRef.current);
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

  function resetWidth() {
    setWidth(SIDEBAR_DEFAULT);
    persistWidth(SIDEBAR_DEFAULT);
  }

  function nudgeWidth(direction: 1 | -1) {
    setWidth((w) => {
      const next = clampWidth(w + direction * KEYBOARD_STEP);
      persistWidth(next);
      return next;
    });
  }

  return { width, max, resizing, startResize: () => setResizing(true), resetWidth, nudgeWidth };
}
