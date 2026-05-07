import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteMe } from "../../lib/api/me.js";

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
      <p className="mb-3 text-sm font-medium text-red-400">Danger zone</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-700 bg-transparent px-4 py-2 text-sm text-red-400 hover:border-red-500 hover:text-red-300"
      >
        Delete account
      </button>

      {open && (
        <dialog
          open
          className="fixed inset-0 z-50 m-0 flex h-full w-full items-center justify-center bg-black/70 p-0"
          aria-modal="true"
        >
          <div className="mx-4 w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="border-b border-gray-700 px-6 py-4">
              <h2 className="text-base font-semibold text-white">Delete account?</h2>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-300">
                This permanently deletes your account, all your games, and all linked sign-in
                providers. This cannot be undone.
              </p>
              {mutation.error && (
                <p className="mt-2 text-xs text-red-400">Failed to delete account. Try again.</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-6 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
                className="rounded-md px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {mutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
