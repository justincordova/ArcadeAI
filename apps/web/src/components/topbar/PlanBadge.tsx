import { Link } from "@tanstack/react-router";
import { useSession } from "../../hooks/useSession.js";

const TIER_STYLES: Record<string, { label: string; className: string }> = {
  free: {
    label: "FREE",
    className: "border border-green-500 text-green-400 bg-transparent",
  },
  creator: {
    label: "CREATOR",
    className: "bg-orange-500 text-white",
  },
  pro: {
    label: "PRO",
    className: "bg-yellow-400 text-gray-900",
  },
  admin: {
    label: "ADMIN",
    className: "bg-gradient-to-r from-purple-600 to-purple-400 text-white",
  },
};

const PLACEHOLDER_CLASS = "w-16 h-5 rounded-full bg-gray-800 animate-pulse";

export function PlanBadge() {
  const { data: me, isLoading } = useSession();

  if (isLoading) {
    return <div className={PLACEHOLDER_CLASS} />;
  }

  const tier = me?.tier ?? "free";
  const style = TIER_STYLES[tier] ?? TIER_STYLES.free;

  return (
    <Link
      to="/pricing"
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tracking-wide transition-opacity hover:opacity-80 ${style.className}`}
    >
      {style.label}
    </Link>
  );
}
