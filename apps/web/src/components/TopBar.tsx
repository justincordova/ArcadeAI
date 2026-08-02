import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, LogOut, Settings as SettingsIcon } from "lucide-react";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import { useOutsideClick } from "../hooks/useOutsideClick.js";
import { useSession } from "../hooks/useSession.js";
import { signOut } from "../lib/api/auth.js";
import { LogoFull } from "./Logo.js";
import { PlanBadge } from "./topbar/PlanBadge.js";

export function TopBar() {
  const { data: me } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close the user menu when the user clicks anywhere outside it, or on
  // Escape. Without this, the menu only closed on the two links it contains
  // (both of which navigate away).
  useOutsideClick(
    menuRef,
    open,
    useCallback(() => setOpen(false), []),
    triggerRef
  );

  const initial = me?.displayName?.[0]?.toUpperCase() ?? "?";

  return (
    <header
      // Horizontal padding and the logo/nav gap are classes rather than
      // inline styles so they can tighten on phones — an inline value can't
      // be overridden by a media query, which is why this bar previously
      // carried its desktop spacing all the way down to 320px and pushed
      // the whole document into horizontal scroll.
      className="gap-2 px-3 sm:px-6"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "var(--layout-topbar-h)",
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Left: Logo + primary nav */}
      <div className="flex min-w-0 items-center gap-3 sm:gap-6">
        <Link to="/" style={{ textDecoration: "none" }} aria-label="ArcadeAI home">
          <LogoFull />
        </Link>
        {/* overflow-x-auto is the backstop: on a 320px screen the two
            labels plus the account controls still don't fit, and scrolling
            the nav within itself is far better than the whole document
            gaining a horizontal scrollbar. At 375px and up nothing
            overflows and the scroller is inert. */}
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <NavLink to="/" label="My Games" />
          <NavLink to="/discover" label="Discover" />
        </nav>
      </div>

      {/* Right: PlanBadge + User. Never shrinks — the account menu is the
          only way out of a signed-in session, so it outranks the nav for
          the last few pixels. */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <PlanBadge />

        {/* User avatar + dropdown */}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 10px 5px 6px",
              borderRadius: 10,
              background: "transparent",
              border: "1px solid transparent",
              cursor: "pointer",
              transition: "all 0.15s",
              color: "var(--color-text-secondary)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--color-surface-raised)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
            }}
            aria-label="User menu"
          >
            {/* Avatar */}
            <span
              style={{
                display: "inline-flex",
                width: 28,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                backgroundImage: "var(--gradient-brand)",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 700,
                color: "#fff",
                flexShrink: 0,
              }}
            >
              {initial}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--color-text-primary)",
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              className="hidden sm:block"
            >
              {me?.displayName ?? "..."}
            </span>
            <ChevronDown
              size={12}
              strokeWidth={1.8}
              // Hidden with the display name below sm: it's purely
              // decorative there (open state is carried by aria-expanded
              // and by the menu itself), and the avatar already reads as a
              // menu trigger without it.
              className="hidden sm:block"
              style={{
                transform: open ? "rotate(180deg)" : "none",
                transition: "transform 0.15s",
                opacity: 0.5,
              }}
            />
          </button>

          {open && (
            <div
              role="menu"
              aria-label="User menu"
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 8px)",
                width: 220,
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 14,
                boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
                overflow: "hidden",
                zIndex: 100,
              }}
            >
              {/* User info */}
              <div
                style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--color-text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {me?.displayName}
                </p>
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 2,
                  }}
                >
                  {me?.email}
                </p>
              </div>

              {/* Nav links */}
              <div style={{ padding: "6px 0" }}>
                <Link
                  to="/settings"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 14px",
                    fontSize: 13,
                    color: "var(--color-text-secondary)",
                    textDecoration: "none",
                    transition: "all 0.12s",
                  }}
                  onClick={() => setOpen(false)}
                  onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    (e.currentTarget as HTMLAnchorElement).style.background =
                      "var(--color-surface-raised)";
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      "var(--color-text-primary)";
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      "var(--color-text-secondary)";
                  }}
                >
                  <SettingsIcon size={14} strokeWidth={1.8} />
                  Settings
                </Link>

                <div
                  style={{
                    height: 1,
                    margin: "6px 14px",
                    background: "var(--color-border)",
                  }}
                />

                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    signOut();
                  }}
                  style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 14px",
                    fontSize: 13,
                    color: "var(--color-text-muted)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    transition: "all 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "var(--color-surface-raised)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--color-danger)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-muted)";
                  }}
                >
                  <LogOut size={14} strokeWidth={1.8} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ to, label }: { to: "/" | "/discover"; label: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = to === "/" ? path === "/" : path.startsWith(to);
  return (
    <Link
      to={to}
      // nowrap: without it these wrap to two lines when the bar gets tight
      // and blow out the fixed 56px header height.
      className="whitespace-nowrap px-2 py-1.5 sm:px-3"
      style={{
        position: "relative",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        textDecoration: "none",
        transition: "color 0.12s",
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
        if (!active)
          (e.currentTarget as HTMLAnchorElement).style.color = "var(--color-text-primary)";
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
        if (!active)
          (e.currentTarget as HTMLAnchorElement).style.color = "var(--color-text-secondary)";
      }}
    >
      {label}
      {active && (
        <span
          aria-hidden="true"
          // Insets track the link's responsive padding so the underline
          // stays flush with the label at both sizes.
          className="left-2 right-2 sm:left-3 sm:right-3"
          style={{
            position: "absolute",
            bottom: -2,
            height: 2,
            backgroundImage: "var(--gradient-brand)",
            borderRadius: 1,
          }}
        />
      )}
    </Link>
  );
}
