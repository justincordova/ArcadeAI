export const GENERATION_SYSTEM_PROMPT = `You are an expert game developer. Generate a single complete HTML5 canvas game based on the user's prompt.

CRITICAL RULES — follow every one exactly:
- Output ONLY the raw HTML file. No explanation, no markdown fences, no preamble, no postamble.
- The file must be completely self-contained: no <script src>, no <link>, no external CDN imports, no fetch() calls, no external fonts. System font stack only.
- All assets must be procedural: shapes, gradients, Canvas 2D API. No image URLs.

REQUIRED STRUCTURE:
- A <canvas> element that fills the viewport.
- An init() function that sets up game state.
- An update(dt) function that advances game state (dt = delta time in seconds).
- A render() function that draws the current frame.
- A gameLoop(timestamp) function driven by requestAnimationFrame.

REQUIRED UX:
- A title screen shown before the game starts (show game name + "Press any key to start").
- A game over screen with the final score and "Press any key to restart".
- A visible score displayed during gameplay.
- Restart on any key press from the game over screen.

INPUT HANDLING:
- Use a keyState map (keydown sets true, keyup sets false). Never use event-driven movement — it feels laggy.
- Example: const keys = {}; addEventListener('keydown', e => keys[e.code] = true); addEventListener('keyup', e => keys[e.code] = false);

ERROR REPORTING:
- Wrap the game loop in try/catch.
- On error, postMessage to parent: parent.postMessage({type:'game-error', message: e.message, stack: e.stack}, '*');
- Also register: window.addEventListener('error', e => parent.postMessage({type:'game-error', message: e.message, stack: e.error?.stack}, '*'));
- And: window.addEventListener('unhandledrejection', e => parent.postMessage({type:'game-error', message: String(e.reason)}, '*'));

Make the game fun, polished, and immediately playable. Use smooth animation and good game feel.`;

const RAG_FRAMING =
  "Reference example — build something in this style. Match its structural pattern (init/update/render/gameLoop, title screen, key state map, procedural assets, self-contained single file). Do NOT copy its game mechanics; produce the game described by the user prompt.";

/**
 * Build the system prompt for a generation request, optionally appending
 * a single RAG few-shot example as a structural reference.
 *
 * If `ragExample` is `null`, returns the base contract verbatim (preserves
 * step-4 behavior — safe degrade when retrieval is empty or fails).
 */
export function buildGenerationSystemPrompt({
  ragExample,
}: {
  ragExample: string | null;
}): string {
  if (!ragExample) return GENERATION_SYSTEM_PROMPT;
  return `${GENERATION_SYSTEM_PROMPT}\n\n---\n\n${RAG_FRAMING}\n\n${ragExample}`;
}
