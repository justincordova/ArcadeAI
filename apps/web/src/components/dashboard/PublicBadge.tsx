// "Public" pill rendered on shared game cards. Top-left in grid view,
// inline next to the title in list view.

import { Globe } from "lucide-react";

export function PublicBadge() {
  return (
    <span
      title="This game is publicly shareable"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 7px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--color-success)",
        background: "rgba(9,9,15,0.75)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(34,211,160,0.4)",
      }}
    >
      <Globe size={9} strokeWidth={2.2} />
      Public
    </span>
  );
}
