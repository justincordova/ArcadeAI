import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { fetchMe, startSocialSignIn } from "../lib/auth.js";

interface SignInSearch {
  next?: string;
}

function validateNext(next: string | undefined): string {
  if (!next) return "/";
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const me = await fetchMe();
    if (me) {
      throw redirect({ to: validateNext(search.next) });
    }
  },
  component: SignInPage,
});

function SignInPage() {
  const { next } = Route.useSearch();
  const nextUrl = validateNext(next);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"google" | "github" | null>(null);

  const handleSignIn = async (provider: "google" | "github") => {
    setError(null);
    setPending(provider);
    try {
      await startSocialSignIn(provider, nextUrl);
    } catch (err) {
      setPending(null);
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
        <h1 className="mb-2 text-2xl font-bold text-white">ArcadeAI</h1>
        <p className="mb-8 text-sm text-gray-400">Sign in to build browser games with AI</p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => handleSignIn("google")}
            disabled={pending !== null}
            className="flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === "google" ? "Redirecting…" : "Continue with Google"}
          </button>
          <button
            type="button"
            onClick={() => handleSignIn("github")}
            disabled={pending !== null}
            className="flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === "github" ? "Redirecting…" : "Continue with GitHub"}
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
