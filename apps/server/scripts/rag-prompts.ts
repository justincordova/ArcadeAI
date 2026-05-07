/**
 * Curated reference prompts for the RAG library (SPEC §8).
 *
 * Each entry has a matching HTML file at `rag-curated/<id>.html`. The prompt
 * is what gets embedded — at retrieval time, a user's runtime prompt is
 * embedded and compared against these via cosine distance to pick the
 * nearest reference.
 *
 * Roughly 2-3 entries per genre bucket from SPEC §6:
 *   paddle, snake, flappy, shooter, platformer, puzzle, runner, other.
 *
 * This file is editorial and committed. Edit deliberately.
 */
export type Genre =
  | "paddle"
  | "snake"
  | "flappy"
  | "shooter"
  | "platformer"
  | "puzzle"
  | "runner"
  | "other";

export interface RagPrompt {
  id: string;
  genre: Genre;
  prompt: string;
}

export const RAG_PROMPTS: readonly RagPrompt[] = [
  // ── paddle ──────────────────────────────────────────────────────────
  {
    id: "paddle-classic-pong",
    genre: "paddle",
    prompt:
      "a classic two-paddle pong game where the player controls the left paddle with W and S, the AI controls the right paddle, the ball speeds up after each volley, and the first to seven points wins",
  },
  {
    id: "paddle-breakout-neon",
    genre: "paddle",
    prompt:
      "a breakout style brick-breaking game with a horizontal paddle, glowing neon bricks in rows of different colors that disappear when hit, three lives, and the ball angle changes based on where it hits the paddle",
  },
  {
    id: "paddle-arkanoid-powerups",
    genre: "paddle",
    prompt:
      "a brick breaker with falling power-ups that drop from broken bricks: a wide-paddle pickup, a slow-ball pickup, and a multi-ball pickup, with three lives and a stage that ends when all bricks are cleared",
  },

  // ── snake ───────────────────────────────────────────────────────────
  {
    id: "snake-classic-grid",
    genre: "snake",
    prompt:
      "a classic snake game on a tile grid where you eat red food pellets to grow longer, dying if you hit the wall or your own tail, with a score for each pellet eaten",
  },
  {
    id: "snake-wraparound-portals",
    genre: "snake",
    prompt:
      "a snake game where the snake wraps around the edges of the screen instead of dying, with food that occasionally turns gold and is worth bonus points, and the snake speeds up gradually as it grows",
  },

  // ── flappy ──────────────────────────────────────────────────────────
  {
    id: "flappy-bird-pipes",
    genre: "flappy",
    prompt:
      "a flappy-bird style game where you tap the spacebar to flap a bird upward through gaps in scrolling green pipes, dying on collision, with the score increasing each time you pass a pipe",
  },
  {
    id: "flappy-rocket-asteroids",
    genre: "flappy",
    prompt:
      "a single-button vertical-scroller where you flap a rocket between drifting asteroid clusters, gravity pulling it down constantly, with a thruster flame trail and the score climbing the further you fly",
  },

  // ── shooter ─────────────────────────────────────────────────────────
  {
    id: "shooter-space-invaders",
    genre: "shooter",
    prompt:
      "a space invaders clone where you move a ship left and right across the bottom firing bullets upward at descending rows of alien marchers that fire back, three lives, and the wave resets faster each time you clear it",
  },
  {
    id: "shooter-asteroid-field",
    genre: "shooter",
    prompt:
      "a top-down asteroid shooter where you rotate and thrust a ship around an open field, firing bullets to break large asteroids into smaller fragments, with wraparound screen edges and increasing waves",
  },
  {
    id: "shooter-twin-stick-arena",
    genre: "shooter",
    prompt:
      "a top-down arena shooter where WASD moves the player and arrow keys aim and shoot in eight directions at swarming enemies that close in from the edges, with a kill counter that drives wave intensity",
  },

  // ── platformer ──────────────────────────────────────────────────────
  {
    id: "platformer-jump-and-run",
    genre: "platformer",
    prompt:
      "a side-scrolling platformer with a square hero who runs left and right and jumps with the spacebar across floating platforms, collecting coins and avoiding spike pits, reaching a flag at the end to win",
  },
  {
    id: "platformer-coyote-time-precision",
    genre: "platformer",
    prompt:
      "a precision platformer with tight controls including coyote time and variable-height jumps, with bouncing enemies on patrol routes that stomp from above to defeat, working through a series of single-screen rooms",
  },

  // ── puzzle ──────────────────────────────────────────────────────────
  {
    id: "puzzle-match-three",
    genre: "puzzle",
    prompt:
      "a match-three puzzle on a colorful grid where you swap adjacent gems to line up three or more of the same color, with cascading combos for chain bonuses and a target score per level",
  },
  {
    id: "puzzle-sliding-tile",
    genre: "puzzle",
    prompt:
      "a sliding tile puzzle where you arrange numbered tiles into order in a four-by-four grid by sliding them into the empty space, with a move counter and a timer",
  },
  {
    id: "puzzle-tetris-lines",
    genre: "puzzle",
    prompt:
      "a tetris style falling-block puzzle where seven different shapes fall from the top, you rotate and shift them into a tight stack, completed horizontal lines clear and award points, and the fall speed increases over time",
  },

  // ── runner ──────────────────────────────────────────────────────────
  {
    id: "runner-endless-jumper",
    genre: "runner",
    prompt:
      "an endless side-scrolling runner where the player auto-runs to the right and jumps with the spacebar over obstacles like cacti and low walls, with the world scrolling faster the longer you survive",
  },
  {
    id: "runner-lane-switcher",
    genre: "runner",
    prompt:
      "a three-lane endless runner where the player tilts left and right between lanes to dodge oncoming traffic, picks up coins, and survives as long as possible, with a distance counter as the score",
  },

  // ── other ───────────────────────────────────────────────────────────
  {
    id: "other-tower-defense-mini",
    genre: "other",
    prompt:
      "a minimalist tower defense game where enemies walk along a fixed path and you click empty grid cells to place towers that auto-fire at anything in range, with a gold economy from kills and waves of increasing difficulty",
  },
  {
    id: "other-color-survival-dodger",
    genre: "other",
    prompt:
      "a top-down survival dodger where you move a circle around an arena avoiding shapes that spawn from the edges and home in on you, with a survival timer and shapes that get faster the longer you live",
  },
  {
    id: "other-rhythm-tap",
    genre: "other",
    prompt:
      "a rhythm tap game where colored notes scroll down four lanes and you press the corresponding key when each note crosses the hit line, with a combo meter, score multiplier, and a fixed song duration",
  },
];
