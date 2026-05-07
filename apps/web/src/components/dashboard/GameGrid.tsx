import type { GameSummary } from "../../lib/api/games.js";
import { GameCard } from "./GameCard.js";
import { NewGameTile } from "./NewGameTile.js";

interface GameGridProps {
  games: GameSummary[];
}

export function GameGrid({ games }: GameGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <NewGameTile />
      {games.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}
