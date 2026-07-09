// Closes a popover/menu when the user clicks (mousedown) outside of it.
// Shared by the several dropdowns that each reimplemented this identical
// effect (TopBar user menu, PlanBadge, GameCard kebab menu).
//
// Listens on `mousedown` rather than `click` so the menu closes before any
// button inside a sibling element fires its own click. The listener is only
// attached while `active` is true, so a closed menu costs nothing.

import { type RefObject, useEffect } from "react";

export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void
) {
  useEffect(() => {
    if (!active) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, active, onOutside]);
}
