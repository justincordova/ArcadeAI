import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useSession } from "../hooks/useSession.js";
import { signOut } from "../lib/auth.js";

export function TopBar() {
  const { data: me } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <header className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-3">
      <Link to="/" className="text-lg font-bold tracking-tight text-white">
        ArcadeAI
      </Link>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-700 text-xs font-medium text-white">
            {me?.displayName?.[0]?.toUpperCase() ?? "?"}
          </span>
          <span className="hidden sm:block">{me?.displayName ?? "..."}</span>
          <span className="text-xs">▾</span>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
            <div className="border-b border-gray-700 px-4 py-3">
              <p className="text-sm font-medium text-white">{me?.displayName}</p>
              <p className="truncate text-xs text-gray-400">{me?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
