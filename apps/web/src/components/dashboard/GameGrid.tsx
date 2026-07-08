import type { GameSummary } from "@/lib/api/games.js";
import { GameCard } from "./GameCard.js";

interface GameGridProps {
  games: GameSummary[];
  view: "grid" | "list";
}

export function GameGrid({ games, view }: GameGridProps) {
  if (view === "list") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {games.map((game) => (
          <GameCard key={game.id} game={game} view="list" />
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        // Adaptive columns so the grid collapses gracefully on tablet/mobile
        // instead of forcing three cramped columns at every width. Matches
        // the Discover gallery's template so the two galleries stay
        // consistent. GameCardSkeleton must mirror this exactly (zero reflow).
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 14,
      }}
    >
      {games.map((game) => (
        <GameCard key={game.id} game={game} view="grid" />
      ))}
    </div>
  );
}
