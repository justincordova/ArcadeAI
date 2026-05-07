import { Link } from "@tanstack/react-router";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-gray-700 bg-gray-800/50">
        <span className="text-3xl">🕹</span>
      </div>
      <h2 className="mb-2 font-mono text-xl font-semibold text-white">No games yet.</h2>
      <p className="mb-8 max-w-xs text-sm text-gray-500">
        Describe any 2D arcade game and watch it come to life in seconds.
      </p>
      <Link
        to="/game/new"
        className="inline-flex items-center gap-2 rounded-lg border border-indigo-500 bg-indigo-600/20 px-6 py-3 font-mono text-sm font-medium text-indigo-300 transition-colors hover:bg-indigo-600/40"
      >
        <span>+</span> Create your first game
      </Link>
    </div>
  );
}
