interface RepairFallbackDialogProps {
  open: boolean;
  onClose: () => void;
  error: { message: string; stack?: string };
  brokenCode: string;
  onTryAgain: () => void;
  onRefine: () => void;
}

export function RepairFallbackDialog({
  open,
  onClose,
  error,
  brokenCode,
  onTryAgain,
  onRefine,
}: RepairFallbackDialogProps) {
  if (!open) return null;

  const truncatedMessage =
    error.message.length > 200 ? `${error.message.slice(0, 200)}…` : error.message;

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-full w-full items-center justify-center bg-black/70 p-0"
      aria-modal="true"
    >
      <div className="mx-4 w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="border-b border-gray-700 px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            We couldn't fix this game automatically.
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="mb-3 font-mono text-sm text-red-300">{truncatedMessage}</p>
          <details className="group">
            <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-400">
              Show broken code
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded border border-gray-700 bg-gray-950 p-3 text-xs text-gray-300">
              <code>{brokenCode}</code>
            </pre>
          </details>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onRefine}
            className="rounded-md border border-gray-600 bg-gray-800 px-4 py-1.5 text-sm text-white hover:bg-gray-700"
          >
            Refine
          </button>
          <button
            type="button"
            onClick={onTryAgain}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Try again
          </button>
        </div>
      </div>
    </dialog>
  );
}
