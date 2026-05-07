import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { LogoMark } from "../components/Logo.js";
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

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

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
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--color-bg)" }}
    >
      {/* Background grid pattern */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(124,58,237,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          pointerEvents: "none",
        }}
      />
      {/* Glow orbs */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 600,
          height: 300,
          background: "radial-gradient(ellipse, rgba(124,58,237,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Card */}
        <div
          className="relative overflow-hidden rounded-2xl p-8"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 0 0 1px rgba(124,58,237,0.1), 0 24px 64px rgba(0,0,0,0.6)",
          }}
        >
          {/* Gradient top edge */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: "linear-gradient(90deg, #7c3aed 0%, #06b6d4 100%)",
            }}
          />

          {/* Logo */}
          <div className="mb-8 flex flex-col items-center gap-3">
            <LogoMark size={40} />
            <div className="text-center">
              <h1
                className="font-mono text-2xl font-bold"
                style={{
                  background: "linear-gradient(135deg, #a78bfa 0%, #06b6d4 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                ArcadeAI
              </h1>
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Build browser games with AI
              </p>
            </div>
          </div>

          {/* Divider */}
          <div
            className="mb-6"
            style={{
              height: 1,
              background: "linear-gradient(90deg, transparent, var(--color-border), transparent)",
            }}
          />

          {/* Auth buttons */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => handleSignIn("google")}
              disabled={pending !== null}
              className="group flex items-center justify-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "var(--color-surface-raised)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              onMouseEnter={(e) => {
                if (pending === null)
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(124,58,237,0.5)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
              }}
            >
              <GoogleIcon />
              {pending === "google" ? "Redirecting..." : "Continue with Google"}
            </button>

            <button
              type="button"
              onClick={() => handleSignIn("github")}
              disabled={pending !== null}
              className="group flex items-center justify-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "var(--color-surface-raised)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              onMouseEnter={(e) => {
                if (pending === null)
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(124,58,237,0.5)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
              }}
            >
              <GitHubIcon />
              {pending === "github" ? "Redirecting..." : "Continue with GitHub"}
            </button>
          </div>

          {error && (
            <p className="mt-4 text-center text-xs" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          )}

          <p className="mt-6 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
            By signing in you agree to our terms of service.
          </p>
        </div>
      </div>
    </div>
  );
}
