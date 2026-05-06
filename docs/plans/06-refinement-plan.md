# 06 — Refinement — Plan

Companion to `docs/designs/06-refinement.md`.

## Pre-flight

- [ ] Step 4 (single-shot generation) is complete and working:
      `POST /api/games` streams via SSE, `meta`/`chunk`/`done`/`error`
      schema is in place, `apps/server/src/lib/sse.ts` and
      `apps/server/src/lib/active-streams.ts` exist, the LLM client
      module (`apps/server/src/services/llm/client.ts`) exports the
      Sonnet streaming helper, the iframe wrapper injection works on
      the client, `useStreamedGeneration` parses SSE frames cleanly.
- [ ] Step 5 (dashboard + game CRUD UI) is complete: `GET /api/games`
      lists games with thumbnails, `POST /api/games/:id/thumbnail`
      accepts a base64 PNG and persists it, the client-side thumbnail
      capture utility (canvas → PNG → POST) is callable from the
      builder. Refinement reuses this utility verbatim — no changes
      to the thumbnail endpoint or capture function in this step.
- [ ] `OPENAI_API_KEY` is present in `.env` and listed in
      `.env.example` (SPEC §15 already requires this — needed here
      for the GPT-4.1-mini summarization fallback).
- [ ] `@ai-sdk/openai` is installed in `apps/server` (or install in
      this step). Step 4 only required `@ai-sdk/anthropic`.
- [ ] `MINI = 'gpt-4.1-mini'` is exported from
      `packages/shared/src/models.ts` (SPEC §3 commits to centralizing
      model ids there). Add it if not already present.
- [ ] Confirm session middleware and ownership checks from step 2/3
      apply to `POST /api/games/:id/refine` once registered (404 on
      not-owned per SPEC §14).
- [ ] Confirm step 4's chat panel renders `messages` for the loaded
      game in `created_at` order. If it currently only renders the
      single `kind='prompt'` row, audit and extend it to render
      `kind='feedback'` rows alongside before this step's UI work.

## Ordered tasks

### Server

1. **Model id constant.** `packages/shared/src/models.ts` — ensure
   `MINI = 'gpt-4.1-mini'` is exported alongside `SONNET` (SPEC §3).
   No-op if step 4 already added it.

2. **Refinement system prompt.**
   `apps/server/src/services/llm/prompts/refinement.ts` — export
   `REFINEMENT_SYSTEM_PROMPT`. Builds on the §13 base contract used
   by `GENERATION_SYSTEM_PROMPT` (single complete HTML, required
   structure, procedural assets, wrapped game loop, self-contained,
   etc.) and adds the refinement-specific instruction: "Apply the
   user's feedback to the current game code. Preserve user-visible
   behavior unless the feedback explicitly asks for a rewrite. If
   the feedback is fundamentally incompatible with the current code
   (different genre, different core mechanic), rewrite from scratch."
   Output contract is identical to generation: a single complete HTML
   file, no markdown fences, no preamble. Path matches SPEC §13.

3. **Code summarization service.**
   `apps/server/src/services/llm/summarize.ts` — export
   `summarizeCode(html: string): Promise<string>`. Implementation:
   - Single `generateText` call against `openai(MINI)` (non-streaming
     — the digest is small and we need it before the Sonnet call
     starts).
   - Fixed system prompt: "Summarize this single-file HTML game into
     a structural digest for another model that will rewrite parts
     of it. Include: function signatures (name + params), top-level
     constants and their roles, brief outline of the main game loop
     and state machine. Do NOT reproduce the full code. Be terse."
   - User message: the HTML.
   - Returns the resulting text.
   - SPEC §16 / §18 budget the cost at ~$0.001 per call.

4. **Refinement context builder.**
   `apps/server/src/services/refinement/context.ts` — export
   `buildRefinementContext({ game, feedback, pastFeedback })`:
   - Inputs: the `games` row, the new feedback string, an array of
     prior feedback strings (ordered ascending by `created_at`,
     excluding the current one).
   - If `game.current_code.length / 4 > 2000`, await
     `summarizeCode(game.current_code)` and use the digest;
     otherwise use the full code (SPEC §16).
   - Assemble the user-message body verbatim per SPEC §16:
     ```
     Original prompt: "<game.original_prompt>"

     Past changes requested:
     - "<pastFeedback[0]>"
     - "<pastFeedback[1]>"
     ...

     Current code:
     <code or digest>

     Current request: "<feedback>"
     ```
     (If `pastFeedback` is empty, the "Past changes requested:" block
     is omitted entirely — keeps the prompt clean for first-time
     refinements.)
   - Returns `{ system: REFINEMENT_SYSTEM_PROMPT, prompt: assembled }`.
   - Pure function aside from the optional summarization call;
     unit-testable later.

5. **LLM client extension.**
   `apps/server/src/services/llm/client.ts` — add a
   `streamRefinement({ system, prompt, signal })` helper (or, if the
   step-4 `streamGame` is already generic enough, alias / reuse it).
   Same Sonnet model, same `streamText` shape from step 4.

6. **Refinement route handler.**
   `apps/server/src/routes/games.ts` — register
   `POST /api/games/:id/refine`:
   - Zod-validate body `{ feedback: string }` (min length 1 after
     trim, max 2000 chars to match step 4's prompt validation
     (standardized in step 04 design)). Use
     `z.string().min(1).max(2000)`.
   - Session check (existing).
   - `SELECT * FROM games WHERE id = ? AND user_id = ?` — 404 if
     missing (SPEC §14).
   - Reject with 400 if `current_code === ''` (defensive — should
     not happen via UI).
   - `acquire(userId)` from step 4's concurrency module; 409 with
     `{ error: 'A generation is already in progress' }` on
     contention (SPEC §14).
   - `INSERT INTO messages (id, game_id, kind, content, created_at)
     VALUES (?, ?, 'feedback', ?, ?)` (SPEC §5).
   - `SELECT content FROM messages WHERE game_id = ? AND
     kind = 'feedback' AND id != ? ORDER BY created_at ASC` to load
     `pastFeedback`.
   - `const { system, prompt } = await buildRefinementContext({
     game, feedback, pastFeedback })`.
   - `reply.hijack()`; `writeSSEHeaders`;
     `writeSSE('meta', { gameId: game.id, placeholderTitle: game.title })`.
   - `AbortController`; `request.raw.on('close', () => ac.abort())`.
   - `for await (const delta of streamRefinement({ system, prompt,
     signal: ac.signal }).textStream)` — accumulate;
     `writeSSE('chunk', { delta })`.
   - On normal completion: `UPDATE games SET current_code = ?,
     updated_at = ? WHERE id = ?`; `writeSSE('done', {})`.
   - On AI SDK error (not abort): `writeSSE('error', { message })`;
     do NOT update `current_code` (last good version remains).
   - On client-close abort: skip the persist and skip the `error`
     event (socket already dead). The `messages` feedback row stays —
     it accurately reflects what the user asked for.
   - `finally`: `release(userId)`; `endSSE`.

7. **Route registration sanity.** Ensure ownership checks from step
   3 still apply to existing endpoints and that the new
   `:id/refine` route does not accidentally match another route's
   pattern.

### Client

8. **Shared SSE primitive (small refactor).**
   `apps/web/src/hooks/useStreamedSSE.ts` — extract the SSE-frame
   parsing and AbortController lifecycle from step 4's
   `useStreamedGeneration` into a reusable hook:
   ```
   useStreamedSSE({
     onMeta(data),
     onChunk(data),
     onDone(),
     onError(message),
   }) → { status, start({ url, body }), stop() }
   ```
   Update `useStreamedGeneration` to be a thin wrapper around it
   that handles the `replaceState` + URL swap on `meta`. This
   refactor is optional but simplifies the new refinement hook.
   If step 4's hook is already generic, skip the refactor.

9. **Refinement hook.**
   `apps/web/src/hooks/useStreamedRefinement.ts` — exports
   `useStreamedRefinement(gameId)` returning
   `{ status, streamingCode, error, refine(feedback), stop() }`.
   - `refine(feedback)`:
     - Calls the shared SSE primitive with
       `url = /api/games/${gameId}/refine`, body `{ feedback }`.
     - On `meta`: invalidate or update local optimistic state for
       the messages list (per design doc decision: invalidate
       `['game', gameId]` on `done`, render an optimistic pending
       bubble in the chat panel until refetch).
     - On `chunk`: append delta to `streamingCode`.
     - On `done`:
       - Replace the iframe-bound `code` with the accumulated
         `streamingCode`.
       - Clear `streamingCode`.
       - Trigger thumbnail capture (reuse step 5's utility) after
         the standard ~2s delay (SPEC §7).
       - Invalidate `['game', gameId]` so the messages list
         refetches with the persisted feedback row.
     - On `error`: set `status = 'error'`; leave the iframe content
       as-is (last good game).
   - `stop()` calls the underlying abort.

10. **`/game/:id` route wiring.**
    `apps/web/src/routes/game.$id.tsx` — wire the prompt input at
    the bottom of the chat panel to `refine` when the game already
    has `current_code`. Submission flow:
    - Read `feedback` from input; clear input.
    - Optimistically render a pending feedback message in the chat
      panel (so the user sees their text immediately).
    - Call `refine(feedback)`.
    - Disable the input while `status === 'streaming'` (SPEC §12 —
      "Persistent prompt input at bottom, disabled during
      streaming").
    - On `error`, restore the input value (or surface a toast and
      keep input enabled — pick whichever matches existing patterns
      from step 4).

11. **Chat panel — feedback rendering.**
    `apps/web/src/components/builder/ChatPanel.tsx` (or wherever
    step 4 placed it) — ensure both `kind='prompt'` and
    `kind='feedback'` rows render in `created_at` order with
    implicit "→ Generated game" markers between them (SPEC §5
    note, §12). If step 4 already handles `kind='feedback'`, this
    is a no-op. If not, extend the renderer to treat both kinds
    uniformly (same visual treatment — SPEC §12 says "simple, no
    chat bubbles").

12. **Iframe re-render and thumbnail recapture.** No new
    component work — the existing `<GameIframe code={code} />`
    from step 4 already re-renders when `code` changes
    (`srcdoc` reassignment is a hard reload per SPEC §9). The
    refinement hook's `onDone` handler is the only new caller of
    the step-5 thumbnail capture utility.

13. **Status overlay reuse.** The "Generating..." overlay from
    step 4 can stay; consider relabeling to "Refining..." while
    `status === 'streaming'` and the route is `/game/:id` with
    pre-existing code. Cosmetic only.

## Verification steps

Run with `bun run dev`, real `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY`. Sign in with an account that already has at
least one generated game from step 4.

1. **Happy-path refinement.**
   - Open an existing game at `/game/:id`.
   - Type "make the paddle wider and faster" into the bottom
     prompt input. Submit.
   - Observe: the new feedback appears in the chat panel
     immediately (optimistic) or shortly after `meta` (post-refetch).
   - Observe: status overlay shows streaming; chat panel's
     collapsible code block fills as chunks arrive.
   - Observe: on `done`, iframe reloads and renders the refined
     game (visible behavior change consistent with the feedback).
   - SQLite check:
     `SELECT kind, content FROM messages WHERE game_id = ? ORDER BY created_at`
     shows the original `prompt` row plus a new `feedback` row
     with the exact submitted text.
   - SQLite check: `games.current_code` differs from the pre-refine
     value; `games.updated_at` is newer.
   - SQLite check: `games.thumbnail` has been updated to a new
     base64 PNG (recapture fired).

2. **Multi-turn refinement (history bulleting).**
   - On the same game, submit a second refinement: "now add
     power-ups".
   - Observe in server logs (or via a temporary debug log in
     `buildRefinementContext`): the assembled prompt's
     "Past changes requested:" block contains the first
     refinement ("make the paddle wider and faster") as a bullet,
     and "Current request:" carries the new feedback.
   - On `done`, both the wider paddle and power-ups are present
     in the new game (verifies Sonnet sees full intent context).

3. **Summarization fallback path.**
   - Manually inflate `current_code` to cross the threshold:
     `UPDATE games SET current_code = current_code || <large filler>`
     so `length(current_code) / 4 > 2000` (i.e. > 8000 chars).
     Easiest: pad with a large `<!-- ... -->` comment block.
   - Submit any small refinement ("change background to dark
     blue").
   - Observe: server logs (or temporary debug) show
     `summarizeCode` was called exactly once for this turn.
   - Observe: the Sonnet user message (logged or breakpointed)
     contains the digest, NOT the full padded HTML.
   - Observe: refinement still completes and produces a valid
     game.
   - Restore the row's `current_code` afterwards (or just delete
     the test game).

4. **Concurrency cap.**
   - Open the same game in two tabs.
   - Submit a refinement in tab A.
   - While tab A is streaming, submit any refinement (or a fresh
     generation in `/game/new`) in tab B.
   - Observe: tab B receives 409 with
     `{ error: 'A generation is already in progress' }`.
   - Tab A continues unaffected.

5. **Cancellation.**
   - Submit a refinement; click **Stop** mid-stream.
   - Observe: stream halts; iframe still shows the pre-refinement
     game (unchanged).
   - SQLite check: `games.current_code` unchanged from before;
     `messages` still has the feedback row.
   - Submit a new refinement immediately — succeeds (the
     concurrency Set was released).

6. **LLM error.**
   - Temporarily corrupt `ANTHROPIC_API_KEY`, restart server.
   - Submit a refinement.
   - Observe: SSE `error` event arrives; iframe unchanged;
     `current_code` unchanged.
   - Restore the key.

7. **Reload preserves history.**
   - After a successful refinement, hard-reload `/game/:id`.
   - Observe: `GET /api/games/:id` returns refined `current_code`
     and full `messages` history.
   - Chat panel renders prompt + every feedback in order.
   - Iframe renders the latest refined game; no streaming
     occurs on load.

8. **Empty / whitespace feedback rejected.**
   - Try to submit "   " — Zod validation rejects with 400; no
     `messages` row inserted; no LLM call.

9. **Build & lint (AGENTS.md pre-commit gate).**
   - `bun run build` (typecheck both workspaces).
   - `bun run check` (Biome).
   - Both pass before committing.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — End of plan

After all tasks complete and the pre-commit gate passes:

```
feat(refine): add refinement endpoint with summarized context
```

Includes: refinement prompt, summarization helper, refinement context service, `POST /api/games/:id/refine` route, and the client streamed-refinement hook + UI wiring.

## Rollback notes

- New files are additive:
  - `apps/server/src/services/llm/prompts/refinement.ts`
  - `apps/server/src/services/llm/summarize.ts`
  - `apps/server/src/services/refinement/context.ts`
  - `apps/web/src/hooks/useStreamedRefinement.ts`
  - (optional) `apps/web/src/hooks/useStreamedSSE.ts`
  Deleting them removes the refinement surface entirely.
- The only edits to existing code are:
  - The new route registration in
    `apps/server/src/routes/games.ts` — drop the `/:id/refine`
    handler block.
  - Possibly an extension to `apps/server/src/services/llm/client.ts`
    if a `streamRefinement` helper was added — revert by removing it.
  - The chat-panel renderer (if extended in step 11 to handle
    `kind='feedback'`) — leave as-is; rendering both kinds is
    forward-compatible and harmless even without refinement.
  - The `/game/:id` route's prompt-input wiring — revert to a
    disabled / no-op input.
- No schema migrations. `messages.kind = 'feedback'` is already
  part of the step-3 schema (SPEC §5).
- `package.json` additions in this step (`@ai-sdk/openai` if not
  already present) can be removed via `bun remove`. Step 7's
  credit work and step 10's classification both reuse
  `@ai-sdk/openai`, so it will be re-added soon if removed now.
- `users.credits_remaining_*` and `usage_log` are untouched (SPEC
  §10 / step 7); no credit state to undo.
- `activeStreams` is process-local; restarting the server clears
  any stuck entries from a botched run.
- `games.current_code` rollback: SPEC §5 stores latest-only with
  no version history, so rolling back a *specific* refinement's
  effect on `current_code` requires manually re-running an
  earlier prompt or restoring from a backup. This is a SPEC-level
  property, not a step-6 limitation.
