import { Link } from "@tanstack/react-router";

export function NewGameTile() {
  return (
    <Link
      to="/game/new"
      className="group flex aspect-video flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/50 transition-all hover:border-indigo-500 hover:bg-indigo-600/10"
    >
      <span className="mb-2 text-2xl text-gray-600 transition-colors group-hover:text-indigo-400">
        +
      </span>
      <span className="font-mono text-xs text-gray-600 transition-colors group-hover:text-indigo-400">
        New Game
      </span>
    </Link>
  );
}
