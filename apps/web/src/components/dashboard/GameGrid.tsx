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
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 14,
      }}
    >
      {games.map((game) => (
        <GameCard key={game.id} game={game} view="grid" />
      ))}
    </div>
  );
}
