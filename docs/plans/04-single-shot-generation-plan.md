# 04 — Single-shot generation — Plan

Companion to `docs/designs/04-single-shot-generation.md`.

## Pre-flight

- [ ] Confirm `ANTHROPIC_API_KEY` is set in `.env` and `.env.example`
      lists it (SPEC §15 already requires this).
- [ ] Confirm step 3 deliverables are present and working:
      `games` and `messages` tables migrated; `POST /api/games`
      handler exists (row-only); `GET /api/games/:id` returns the
      row; ownership checks return 404 on mismatch.
- [ ] Confirm step 2 session middleware gates `/api/games` so
      `request.session.user.id` is reliably available in the handler.
- [ ] Install dependencies in `apps/server`:
      `bun add ai @ai-sdk/anthropic` (model id `claude-sonnet-4-6`,
      pinned via `packages/shared/src/models.ts` per SPEC §3).
- [ ] Add the model id constant to `packages/shared/src/models.ts`
      if not already present (SPEC §3 commits to centralizing model
      ids there).
- [ ] Verify dev server runs and `/api/health` still responds.

## Ordered tasks

### Server

1. **Model id constant.** `packages/shared/src/models.ts` —
   export `SONNET = 'claude-sonnet-4-6'` (and other model ids if
   not yet present, but only `SONNET` is consumed in this step).

2. **Hardcoded system prompt.**
   `apps/server/src/services/llm/prompts/generation.ts` —
   export `GENERATION_SYSTEM_PROMPT` covering the §13 base contract:
   single complete HTML file, no markdown fences, required
   `<canvas>` + `init`/`update`/`render`/`gameLoop` structure,
   title screen + game over, key state map for input, procedural
   assets only, try/catch wrap with `parent.postMessage`,
   self-contained (no external `<script src>`/`<link>`/fonts).
   No genre variants in this step.

3. **LLM client module.**
   `apps/server/src/services/llm/client.ts` — instantiate the
   `@ai-sdk/anthropic` provider; export
   `streamGame({ prompt, signal })` returning `streamText({...})`'s
   text stream. Reads `ANTHROPIC_API_KEY` from env. Uses the
   shared `SONNET` model id constant.

4. **SSE helper.**
   `apps/server/src/lib/sse.ts` — export
   `writeSSE(reply, event, data)`,
   `writeSSEHeaders(reply)`, and `endSSE(reply)`.
   Frame format: `event: <name>\ndata: <json>\n\n`. Calls
   `reply.raw.flushHeaders()` once and `reply.raw.write()`
   thereafter, with `reply.hijack()` so Fastify doesn't try to
   serialize the response.

5. **Concurrency Set.**
   `apps/server/src/lib/active-streams.ts` — module-scoped
   `Set<string>`; export `acquire(userId)` (throws a typed
   `ConcurrencyError` if already present) and `release(userId)`.

6. **Extend `POST /api/games`.**
   `apps/server/src/routes/games.ts` — replace the step-3
   row-only response with the streaming pipeline:

   - Zod-validate `{ prompt: string }` (`min(1).max(2000)`,
     matching step 03's plan for consistency).
   - `acquire(userId)`; on `ConcurrencyError` return 409 with
     `{ error: 'A generation is already in progress' }` and do
     NOT enter the SSE branch.
   - Insert `games` row: `id = crypto.randomUUID()`,
     `title = prompt.slice(0, 40)`,
     `current_code = ''`, `original_prompt = prompt`,
     timestamps in unix ms (SPEC §5).
   - Insert `messages` row: `kind = 'prompt'`, `content = prompt`.
   - `reply.hijack()`, `writeSSEHeaders`, write `meta`
     `{ gameId, placeholderTitle: title }`.
   - Construct `AbortController`; wire
     `request.raw.on('close', () => ac.abort())`.
   - `for await (const delta of streamGame({ prompt, signal: ac.signal }).textStream)`
     accumulate and `writeSSE('chunk', { delta })`.
   - On normal completion: `UPDATE games SET current_code = ?,
     updated_at = ? WHERE id = ?`, then `writeSSE('done', {})`.
   - On AI SDK error (other than abort): `writeSSE('error',
     { message })`. Do not delete the row.
   - On abort caused by client close: skip the persist and skip
     the `error` event (the socket is already dead).
   - `finally`: `release(userId)`, `endSSE`.

7. **Route registration & ownership reuse.** Confirm the
   ownership-check middleware introduced in step 3 still applies
   to `GET /api/games/:id` and `DELETE /api/games/:id` and is not
   broken by the changes.

### Client

8. **Streaming hook.**
   `apps/web/src/hooks/useStreamedGeneration.ts` — exports
   `useStreamedGeneration()` returning
   `{ status, gameId, code, error, start(prompt), stop() }`.
   - `status: 'idle' | 'streaming' | 'error'`.
   - `start(prompt)` creates an `AbortController`, calls
     `fetch('/api/games', { method: 'POST', credentials: 'include',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ prompt }), signal })`.
   - If `response.status === 409`, set `status = 'error'` with the
     server's message; do not enter the read loop.
   - Otherwise, get `response.body.getReader()`, `TextDecoder`,
     and a line-buffer that splits on `\n\n` to extract complete
     SSE frames. Parse `event:` and `data:` lines, dispatch:
     - `meta` → `history.replaceState(null, '', '/game/' + gameId)`,
       set `gameId`, set initial title.
     - `chunk` → `setCode(prev => prev + delta)`.
     - `error` → set `status = 'error'`, store message.
     - `done` → set `status = 'idle'`.
   - `stop()` calls `controller.abort()`.

9. **Iframe wrapper.**
   `apps/web/src/lib/iframe-wrapper.ts` — export `WRAPPER_SCRIPT`
   matching SPEC §9 verbatim and `injectWrapper(html)` that
   appends `<script>${WRAPPER_SCRIPT}</script>` immediately
   before `</body>` (or appends at end if `</body>` is absent).

10. **`GameIframe` component.**
    `apps/web/src/components/builder/GameIframe.tsx` — props:
    `{ code: string | null }`. Renders nothing (or a placeholder)
    when `code` is null/empty; otherwise
    `<iframe srcdoc={injectWrapper(code)} sandbox="allow-scripts" />`.
    Mount-once `window.addEventListener('message', ...)` for
    `game-error` events; log to console only (no repair yet).

11. **`StatusOverlay` and `StopButton`.**
    `apps/web/src/components/builder/StatusOverlay.tsx` and
    `StopButton.tsx`. Visible only when `status === 'streaming'`,
    overlaying the iframe pane. Stop button calls the hook's
    `stop()`.

12. **`/game/new` route.**
    `apps/web/src/routes/game.new.tsx` (TanStack Router file
    route) — split-pane layout per SPEC §12. Left: prompt input
    + (optional) collapsible streaming code block fed by
    `code` from the hook. Right: `<GameIframe code={code} />`
    with overlays. On `start`, the hook handles the URL swap
    via `replaceState` — no router navigation.

13. **`/game/:id` route.**
    `apps/web/src/routes/game.$id.tsx` — for direct loads, use
    TanStack Query to `GET /api/games/:id` and seed the same
    builder layout's `code` state. When this route is reached
    via `replaceState` from `/game/new`, the existing component
    instance is preserved (the `replaceState` only updates the
    URL bar; React tree is untouched). To keep it working with
    TanStack Router, ensure both routes render the same builder
    component or share a layout so that switching the URL
    doesn't trigger a remount.

    Pragmatic approach: extract a `<Builder>` component and
    render it from both routes; pass `mode = 'new' | 'load'`.
    Confirm by setting state in the new route and watching it
    survive the URL swap. If TanStack Router insists on
    remounting on route key change, fall back to mounting
    `<Builder>` at a parent route shared by both
    (`/game` layout route) so the swap is a child-route change.

14. **Shared layout / split-pane.** Whatever minimal split-pane
    primitive is needed (SPEC §12: ~35/65). Inline Tailwind
    classes are sufficient — no shadcn primitive required for
    this step. Invoke the `frontend-design` skill when polishing
    the visual treatment (SPEC §12 instruction).

## Verification steps

Run with `bun run dev` and a real `ANTHROPIC_API_KEY`.

1. **Happy path.**
   - Sign in.
   - Navigate to `/game/new`.
   - Type "a simple breakout clone" and submit.
   - Observe: URL changes to `/game/<uuid>` within ~1s.
   - Observe: streaming HTML accumulating in the left panel's
     code block.
   - Observe: on completion, iframe on the right renders a
     playable breakout game.
   - SQLite check: `select id, title, length(current_code) from games`
     shows the row with non-empty `current_code` and the
     placeholder title.
   - SQLite check: `select kind, content from messages where game_id = ?`
     shows one `prompt` row.

2. **`replaceState` does not remount.**
   - Before submitting in step 1, set a sentinel in the builder
     component (e.g. a `useState` counter incremented once on mount,
     or a `useEffect` log that fires on mount and increments a ref).
   - Submit a prompt; observe the URL swap from `/game/new` to
     `/game/:id`.
   - Observe: the mount counter / log fires exactly once across the
     URL swap. The sentinel state set before `meta` arrived is still
     present after the swap. If the counter increments twice, the
     route is remounting and task 13's shared `<Builder>` component
     (or parent layout route) needs to be revisited.

3. **Cancellation.**
   - Submit a prompt; while streaming, click **Stop**.
   - Observe: stream halts, iframe stays empty, status returns
     to idle.
   - Server log shows the client-close abort.
   - SQLite check: `current_code` is empty string for that game.
   - Submit a second prompt immediately — succeeds (concurrency
     Set was released).

4. **Concurrency cap.**
   - Open two tabs to `/game/new`.
   - Submit a long prompt in tab A.
   - While tab A is streaming, submit any prompt in tab B.
   - Observe: tab B receives 409 with the documented body.
   - Tab A continues unaffected.
   - When tab A finishes, tab B can submit successfully.

5. **LLM error.**
   - Temporarily corrupt `ANTHROPIC_API_KEY`, restart server.
   - Submit a prompt.
   - Observe: SSE `error` event arrives; client shows the error.
   - `activeStreams` is empty (verify by submitting again — no
     spurious 409).
   - Restore the key.

6. **Reload after success.**
   - Successful generation in step 1.
   - Hard-reload `/game/:id`.
   - Observe: iframe renders the saved game; no streaming
     occurs; `GET /api/games/:id` is the only network call.

7. **Wrapper injection works.**
   - Generate a game.
   - In DevTools, attach a `message` listener on `window`.
   - In the iframe (via DevTools "select context"), run
     `throw new Error('test')`.
   - Observe: a `{ type: 'game-error', message: 'test' }`
     `postMessage` arrives in the parent window's listener.
   - This confirms the wrapper script is being injected and
     the sandbox is `allow-scripts` only (no `allow-same-origin`,
     so DevTools context-switch is the only way to inject from
     outside; the postMessage path is the in-game contract).

8. **Build & lint.** Per `AGENTS.md` pre-commit gate:
   - `bun run build` (typecheck both workspaces).
   - `bun run check` (Biome).
   - Both pass before committing.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — Server LLM service + SSE

After the **Server** tasks complete (Anthropic streamText service, SSE helper, active-streams registry, updated `POST /api/games`) and the pre-commit gate passes:

```
feat(llm): add anthropic streamText service and SSE helper
```

Includes: `apps/server/src/services/llm/`, `apps/server/src/lib/sse.ts`, `apps/server/src/lib/active-streams.ts`, and the streaming wiring in the `POST /api/games` handler.

### Checkpoint 2 — Builder UI + iframe sandbox

After the **Client** tasks complete (streamed-generation hook, builder route, iframe sandbox) and the pre-commit gate passes:

```
feat(builder): wire single-shot generation with iframe sandbox
```

Includes: client streamed-generation hook, builder route, iframe sandbox component, and any supporting client utilities for the single-shot flow.

## Rollback notes

- All new files are additive: deleting
  `apps/server/src/services/llm/`, `apps/server/src/lib/sse.ts`,
  `apps/server/src/lib/active-streams.ts`, the new client hook,
  components, and routes restores the step-3 surface.
- The only edit to existing code is the `POST /api/games`
  handler. Reverting that handler to its step-3 form (return
  the created row as JSON) is sufficient to roll back the
  streaming path. Keep the row-creation logic intact during
  the edit — the streaming branch wraps it, doesn't replace it.
- No schema migrations in this step. The `games`/`messages`
  tables from step 3 are unchanged.
- `package.json` additions (`ai`, `@ai-sdk/anthropic`) can be
  removed via `bun remove`; nothing else depends on them yet.
- The `users.credits_remaining_*` columns are not touched, so
  there is no credit state to undo.
- `activeStreams` is process-local and in-memory; restarting
  the server clears it.
