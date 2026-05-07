/**
 * System prompt and user-message builder for the auto-repair loop (SPEC §13).
 * Grounded in the §13 base contract: single complete HTML, no fences,
 * canvas/init/update/render/gameLoop structure.
 */
export const REPAIR_SYSTEM_PROMPT = `You are repairing a single-file HTML5 canvas game that crashed at runtime. Preserve all user-visible behavior. Fix only the bug reported below.

CRITICAL RULES — follow every one exactly:
- Output ONLY the raw HTML file. No explanation, no markdown fences, no preamble, no postamble.
- The file must be completely self-contained: no <script src>, no <link>, no external CDN imports, no fetch() calls, no external fonts. System font stack only.
- All assets must be procedural: shapes, gradients, Canvas 2D API. No image URLs.
- Preserve the existing init/update/render/gameLoop structure, title screen, score display, and input handling.
- You are permitted to rewrite the broken function or section entirely if surgical patching is unsafe.
- Do not introduce new gameplay features — only fix the reported error.`;

/**
 * Build the user-message body for a repair request.
 */
export function buildRepairUserMessage(args: {
  originalPrompt: string;
  category: string;
  message: string;
  stack?: string;
  code: string;
}): string {
  return `Original prompt: "${args.originalPrompt}"
Error category: ${args.category}
Error message: "${args.message}"
Stack trace: ${args.stack ?? "(none provided)"}

Current code:
${args.code}`;
}
