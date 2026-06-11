import { useEffect, useRef, useState } from "react";

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

export interface ResizableSidebar {
  /** Current sidebar width in px (clamped to [SIDEBAR_MIN, SIDEBAR_MAX]). */
  width: number;
  /** True while a drag is in progress. */
  resizing: boolean;
  /** Begin a drag — wire to the resize handle's onMouseDown. */
  startResize: () => void;
  /** Reset to the default width and persist — wire to onDoubleClick. */
  resetWidth: () => void;
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
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
      setWidth(next);
    }
    function onUp() {
      setResizing(false);
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current));
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

  function resetWidth() {
    setWidth(SIDEBAR_DEFAULT);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT));
    } catch {}
  }

  return { width, resizing, startResize: () => setResizing(true), resetWidth };
}
