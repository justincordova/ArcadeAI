interface StopButtonProps {
  visible: boolean;
  onStop: () => void;
}

export function StopButton({ visible, onStop }: StopButtonProps) {
  if (!visible) return null;
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
      <button
        type="button"
        onClick={onStop}
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-red-700 active:scale-95"
      >
        Stop
      </button>
    </div>
  );
}
