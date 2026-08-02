// Dismisses a popover/menu on outside click or Escape.
//
// Shared by the several dropdowns that each reimplemented this identical
// effect (TopBar user menu, PlanBadge, GameCard kebab menu).
//
// Listens on `mousedown` rather than `click` so the menu closes before any
// button inside a sibling element fires its own click. The listeners are
// only attached while `active` is true, so a closed menu costs nothing.
//
// Escape support matters because these menus are otherwise a keyboard
// dead end: a pointer user can dismiss them by clicking anywhere, but a
// keyboard user who opens one has no way to close it without tabbing
// through every item. Escape also restores focus to the trigger, since
// unmounting the focused element drops focus to <body> and loses the
// user's place in the tab order.

import { type RefObject, useEffect } from "react";

export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
  /** Focused when Escape closes the menu. Omit to skip focus restoration. */
  triggerRef?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!active) return;

    function handlePointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside();
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Don't let a parent dialog/route also react to the same Escape.
      e.stopPropagation();
      onOutside();
      triggerRef?.current?.focus();
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ref, active, onOutside, triggerRef]);
}
