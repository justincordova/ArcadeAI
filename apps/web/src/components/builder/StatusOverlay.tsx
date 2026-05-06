interface StatusOverlayProps {
  visible: boolean;
}

export function StatusOverlay({ visible }: StatusOverlayProps) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60">
      <div className="flex items-center gap-3 rounded-lg bg-gray-900 px-5 py-3 text-sm text-gray-200 shadow-xl">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-white" />
        Generating…
      </div>
    </div>
  );
}
