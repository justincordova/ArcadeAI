// Inline "rename in place" state machine for editable titles (dashboard game
// cards). Owns the edit-mode flag, the draft value, focus-on-open, and the
// commit path — including the double-commit guard that makes Enter + blur
// idempotent.

import { useEffect, useRef, useState } from "react";

interface UseInlineRenameOptions {
  /** Current committed value; also the fallback when a rename is cancelled. */
  value: string;
  /** Called with the trimmed draft only when it actually changed. */
  onCommit: (next: string) => void;
}

export function useInlineRename({ value, onCommit }: UseInlineRenameOptions) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select the field the moment edit mode opens.
  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  function start() {
    setDraft(value);
    setRenaming(true);
  }

  function commit() {
    // Pressing Enter calls this and sets renaming=false, which unmounts the
    // input and fires onBlur — calling commit a second time. Without this
    // guard the onCommit (a PATCH) fires twice. The re-rendered onBlur closure
    // sees renaming=false, so the guard short-circuits the duplicate call.
    if (!renaming) return;
    const trimmed = draft.trim();
    setRenaming(false);
    if (trimmed && trimmed !== value) {
      onCommit(trimmed);
    } else {
      setDraft(value);
    }
  }

  /** Abandon the edit (Escape) — restore the committed value, close the field. */
  function cancel() {
    setDraft(value);
    setRenaming(false);
  }

  return { renaming, draft, setDraft, inputRef, start, commit, cancel };
}
