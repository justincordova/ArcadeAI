// Public discover gallery — the front door for organic discovery.
//
// Anyone can browse: signed-out visitors see the same content but liking
// and remixing route them through /sign-in. The hero treatment leans
// into the cabinet-neon identity (Space Grotesk display, scanline
// texture, brand-marquee gradient) so this surface reads as the
// product's identity beat, not a utility list.

import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DiscoverCard } from "@/components/discover/DiscoverCard.js";
import { DiscoverFilters } from "@/components/discover/DiscoverFilters.js";
import { LogoFull } from "@/components/Logo.js";
import { TopBar } from "@/components/TopBar.js";
import { useSession } from "@/hooks/useSession.js";
import { type DiscoverGame, type DiscoverSort, fetchDiscover } from "@/lib/api/games.js";
import { setDocumentHead } from "@/lib/document-head.js";

interface DiscoverSearch {
  sort?: DiscoverSort;
  genre?: string;
}

export const Route = createFileRoute("/discover")({
  validateSearch: (search: Record<string, unknown>): DiscoverSearch => ({
    sort:
      typeof search.sort === "string" &&
      (search.sort === "trending" || search.sort === "top" || search.sort === "new")
        ? search.sort
        : undefined,
    genre: typeof search.genre === "string" ? search.genre : undefined,
  }),
  component: DiscoverPage,
});

function DiscoverPage() {
  const { sort: sortParam, genre: genreParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: me } = useSession();

  const sort: DiscoverSort = sortParam ?? "trending";
  const genre = genreParam ?? null;

  const [hovered, setHovered] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["discover", sort, genre],
    queryFn: ({ pageParam }) =>
      fetchDiscover({ sort, genre, limit: 24, offset: pageParam as number }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });

  // Dedupe by id: offset pagination over a live-ranked list means a game
  // can shift across the page boundary between fetches (trending reorders
  // on likes; a new publish shifts "new") and appear at the tail of page N
  // and the head of page N+1 — producing duplicate React keys and a
  // visibly repeated card. First occurrence wins.
  const items: DiscoverGame[] = useMemo(() => {
    const flat = query.data?.pages.flatMap((p) => p.items) ?? [];
    const seen = new Set<string>();
    return flat.filter((g) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
  }, [query.data]);

  useEffect(() => {
    return setDocumentHead({
      title: "Discover · ArcadeAI",
      description:
        "Browse playable games other people built from a single prompt. Like the ones you love, remix anything into your own library.",
      ogTitle: "ArcadeAI · Discover",
      ogDescription: "Playable games built from a prompt. Browse, play, remix.",
    });
  }, []);

  function setSort(next: DiscoverSort) {
    void navigate({
      search: (prev) => ({ ...prev, sort: next === "trending" ? undefined : next }),
    });
  }
  function setGenre(next: string | null) {
    void navigate({
      search: (prev) => ({ ...prev, genre: next ?? undefined }),
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text-primary)",
      }}
    >
      {me ? <TopBar /> : <PublicTopBar />}

      {/* Hero */}
      <section
        className="scanlines"
        style={{
          position: "relative",
          overflow: "hidden",
          borderBottom: "1px solid var(--color-border)",
          padding: "56px 24px 44px",
          textAlign: "center",
          isolation: "isolate",
        }}
      >
        {/* Background layers — mid-saturation magenta haze top-left,
            cyan haze bottom-right; intersecting ellipses create a
            two-tone glow without being a flat radial. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: -1,
            backgroundImage:
              "radial-gradient(ellipse 50% 60% at 25% 30%, rgba(255,62,165,0.18) 0%, transparent 60%), radial-gradient(ellipse 40% 60% at 80% 70%, rgba(76,223,232,0.14) 0%, transparent 65%)",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: -1,
            backgroundImage:
              "linear-gradient(rgba(255,62,165,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,62,165,0.05) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse 70% 80% at 50% 40%, #000 30%, transparent 80%)",
          }}
        />

        <p
          className="font-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.24em",
            color: "var(--color-text-accent)",
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          ▸ Now playing
        </p>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(36px, 6vw, 64px)",
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            margin: 0,
            backgroundImage: "var(--gradient-brand)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          The Arcade Floor
        </h1>
        <p
          style={{
            marginTop: 14,
            fontSize: 15,
            color: "var(--color-text-secondary)",
            maxWidth: 540,
            marginInline: "auto",
            lineHeight: 1.55,
          }}
        >
          Browse games other people built with a single prompt. Like the ones you love, remix
          anything into your own library.
        </p>
      </section>

      {/* Filters. Pinned at the top-bar height unconditionally — BOTH header
          variants above (TopBar and PublicTopBar) are sticky bars of
          --layout-topbar-h, so pinning at 0 for signed-out visitors slid the
          filter row underneath the public top bar (z 20 < z 50), hiding the
          sort/genre controls on scroll. */}
      <div
        style={{
          position: "sticky",
          top: "var(--layout-topbar-h)",
          zIndex: 20,
          background: "color-mix(in srgb, var(--color-bg) 92%, transparent)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "12px 24px" }}>
          <DiscoverFilters
            sort={sort}
            onSortChange={setSort}
            genre={genre}
            onGenreChange={setGenre}
          />
        </div>
      </div>

      {/* Grid */}
      <main
        style={{
          flex: 1,
          maxWidth: 1280,
          width: "100%",
          margin: "0 auto",
          padding: "32px 24px 64px",
        }}
      >
        {query.isLoading ? (
          <DiscoverSkeleton />
        ) : query.isError && items.length === 0 ? (
          // Initial-load failure (no pages yet) — replace the grid with a retry.
          // A failed *subsequent* page keeps the loaded grid and surfaces the
          // error below the list instead (see the load-more block).
          <DiscoverError onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <DiscoverEmpty />
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gap: 18,
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              }}
            >
              {items.map((g) => (
                <DiscoverCard
                  key={g.id}
                  game={g}
                  hovered={hovered === g.id}
                  onHoverChange={(h) => setHovered(h ? g.id : null)}
                  isAuthed={Boolean(me)}
                />
              ))}
            </div>

            {query.hasNextPage && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 36 }}>
                <button
                  type="button"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  style={{
                    padding: "10px 22px",
                    borderRadius: 9,
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    border: "1px solid rgba(255,62,165,0.35)",
                    background:
                      "linear-gradient(135deg, rgba(255,62,165,0.08) 0%, rgba(76,223,232,0.06) 100%)",
                    color: "var(--color-text-primary)",
                    cursor: query.isFetchingNextPage ? "wait" : "pointer",
                    opacity: query.isFetchingNextPage ? 0.6 : 1,
                  }}
                >
                  {query.isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              </div>
            )}

            {/* A failed fetchNextPage leaves the loaded pages intact; surface
                the failure so the user knows more didn't load and can retry. */}
            {query.isError && items.length > 0 && (
              <p
                role="alert"
                style={{
                  textAlign: "center",
                  marginTop: 16,
                  fontSize: 12,
                  color: "var(--color-danger)",
                }}
              >
                Couldn't load more games.{" "}
                <button
                  type="button"
                  onClick={() => void query.fetchNextPage()}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--color-text-primary)",
                    textDecoration: "underline",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  Retry
                </button>
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function PublicTopBar() {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "var(--layout-topbar-h)",
        padding: "0 24px",
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(12px)",
      }}
    >
      <Link to="/" style={{ textDecoration: "none" }} aria-label="ArcadeAI home">
        <LogoFull />
      </Link>
      <Link
        to="/sign-in"
        style={{
          padding: "7px 16px",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "inherit",
          textDecoration: "none",
          color: "#fff",
          backgroundImage: "var(--gradient-brand)",
          boxShadow: "0 2px 14px rgba(255,62,165,0.3)",
        }}
      >
        Sign in
      </Link>
    </header>
  );
}

function DiscoverSkeleton() {
  const cells = Array.from({ length: 8 });
  return (
    <div
      style={{
        display: "grid",
        gap: 18,
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
      }}
    >
      {cells.map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders are stable
          key={i}
          style={{
            borderRadius: 12,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              aspectRatio: "16/10",
              backgroundImage:
                "linear-gradient(110deg, var(--color-surface-raised) 30%, var(--color-surface-overlay) 50%, var(--color-surface-raised) 70%)",
              backgroundSize: "200% 100%",
              animation: "brand-shimmer 1.6s linear infinite",
            }}
          />
          <div style={{ padding: "12px 14px" }}>
            <div
              style={{
                height: 12,
                width: "70%",
                borderRadius: 4,
                background: "var(--color-surface-raised)",
              }}
            />
            <div
              style={{
                marginTop: 8,
                height: 9,
                width: "45%",
                borderRadius: 4,
                background: "var(--color-surface-raised)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DiscoverError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "80px 24px",
        textAlign: "center",
        gap: 12,
      }}
    >
      <p
        className="font-display"
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "var(--color-text-primary)",
          marginBottom: 4,
        }}
      >
        Couldn't load the gallery.
      </p>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", maxWidth: 380 }}>
        Something went wrong fetching games. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        style={{
          marginTop: 4,
          padding: "8px 18px",
          borderRadius: 9,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "inherit",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-text-primary)",
          cursor: "pointer",
        }}
      >
        Retry
      </button>
    </div>
  );
}

function DiscoverEmpty() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "80px 24px",
        textAlign: "center",
      }}
    >
      <p
        className="font-display"
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "var(--color-text-primary)",
          marginBottom: 8,
        }}
      >
        No games here yet.
      </p>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", maxWidth: 380 }}>
        Be the first to publish — build something in the editor and toggle Share to put it on the
        floor.
      </p>
    </div>
  );
}
