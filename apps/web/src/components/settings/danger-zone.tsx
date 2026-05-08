// Permanent account deletion. Behind a confirmation dialog because it
// cascades through games, usage logs, sessions, and OAuth account links.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteMe } from "../../lib/api/me.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";

export function DangerZone() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: deleteMe,
    onSuccess: () => {
      queryClient.clear();
      window.location.assign("/sign-in");
    },
  });

  return (
    <div>
      <Button variant="destructive-outline" size="default" onClick={() => setOpen(true)}>
        Delete account
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!mutation.isPending) setOpen(o);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account, all your games, and all linked sign-in
              providers. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {mutation.error && (
            <p className="text-xs text-[var(--color-danger)]">
              Failed to delete account. Try again.
            </p>
          )}

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
