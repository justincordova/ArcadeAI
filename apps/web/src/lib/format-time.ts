// Human-readable relative timestamps ("just now", "3 minutes ago", "2 days
// ago"). Buckets by magnitude so the largest sensible unit is always used.

/** Format a past epoch-ms timestamp as a short relative string. */
export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return rtf.format(-Math.floor(diff / 60_000), "minute");
  if (diff < 86_400_000) return rtf.format(-Math.floor(diff / 3_600_000), "hour");
  return rtf.format(-Math.floor(diff / 86_400_000), "day");
}
