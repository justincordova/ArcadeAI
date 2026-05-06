# 04 — Single-shot generation

## Overview

Extend `POST /api/games` (introduced in step 3 as a row-only insert) to invoke
Claude Sonnet 4.6 with a hardcoded system prompt and stream the resulting
single-file HTML back to the client over SSE. The frontend consumes the stream
in `/game/new`, swaps the URL to `/game/:id` via `history.replaceState` on the
first `meta` event, and renders the accumulating HTML into a sandboxed iframe
via `srcdoc` with a client-injected wrapper script. AbortController-based
cancellation and a 1-concurrent-generation-per-user cap are wired up.

This step proves the core loop: prompt → streamed game → playable iframe.
Everything else (RAG, classification, refinement, repair, credits, thumbnails,
title generation) is deferred to later steps.

## Goals

- LLM service module wraps `streamText` from the Vercel AI SDK against
  `@ai-sdk/anthropic` with model id `claude-sonnet-4-6` (SPEC §3, §13).
- `POST /api/games` creates the game row, emits a `meta` SSE event with
  `{ gameId, placeholderTitle }`, then streams Sonnet output as `chunk` events
  and terminates with a `done` event (SPEC §11).
- The full accumulated HTML is persisted to `games.current_code` after the
  stream completes successfully.
- Frontend `/game/new` route POSTs to `/api/games` with a `fetch` +
  `ReadableStream` reader, parses SSE frames, and on `meta` calls
  `history.replaceState('/game/:id')` without remounting the component
  (SPEC §12).
- iframe renders via `<iframe srcdoc={code} sandbox="allow-scripts">` with a
  client-side-injected wrapper script appended to the LLM output before
  assignment (SPEC §9, §12). Server stores raw LLM output only.
- Stop button on the iframe overlay aborts the in-flight `fetch` via
  `AbortController`; the server detects client disconnect and aborts the LLM
  stream via the AI SDK's abort signal (SPEC §14).
- A `Set<userId>` in the Fastify process tracks active streams; a second
  concurrent request from the same user gets `409 Conflict` with
  `{ error: 'A generation is already in progress' }` (SPEC §14).

## Non-goals (explicitly deferred)

- **No RAG retrieval.** No `rag_examples` query, no `vec_distance_cosine`,
  no example injection. Hardcoded system prompt only. (Step 9)
- **No genre classification.** No GPT-4.1-mini call, no `style_tags`,
  no genre-specific prompt variants. (Step 10)
- **No title generation.** `placeholderTitle = prompt.slice(0, 40)` is the
  only title written; no PATCH-on-completion. Title generation lands in
  step 10 per SPEC §7 and §19; until then `placeholderTitle = prompt.slice(0, 40)`
  is the only title and persists indefinitely.
- **No auto-repair.** No `/api/games/:id/repair` endpoint, no error categorize
  call. The wrapper script's `postMessage('game-error', ...)` handler is
  injected (SPEC §9) but the client does nothing with the message in this
  step. (Step 11)
- **No credit deduction or `usage_log` writes.** `users.credits_remaining_*`
  is untouched; concurrency cap is the only gating mechanism. Credit
  bookkeeping arrives in step 7. The 1-concurrent-stream Set is structured
  so credit checks slot in alongside it.
- **No thumbnail capture.** No client-side canvas screenshot, no
  `POST /api/games/:id/thumbnail`. (Step 5)
- **No refinement.** `/api/games/:id/refine` does not exist yet. (Step 6)
- **No rate limiting beyond the concurrency Set.** `@fastify/rate-limit`
  is wired in step 13.
- **No structured Pino logging of LLM calls.** Default Fastify logging only
  in this step. (Step 13)

## Architecture

### Server side

```
POST /api/games  (Zod-validated body { prompt: string })
    │
    ├─ session check (existing from step 2)
    ├─ concurrency check: if activeStreams.has(userId) → 409
    ├─ activeStreams.add(userId)
    ├─ insert games row { id, user_id, title=prompt.slice(0,40),
    │                     current_code='', original_prompt=prompt, ... }
    ├─ insert messages row { game_id, kind:'prompt', content:prompt }
    │
    ├─ reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', ... })
    ├─ write SSE 'meta' { gameId, placeholderTitle }
    │
    ├─ AbortController for the LLM call
    ├─ request.raw.on('close', () => abortController.abort())
    │
    ├─ const { textStream } = streamText({
    │     model: anthropic('claude-sonnet-4-6'),
    │     system: HARDCODED_SYSTEM_PROMPT,
    │     prompt: userPrompt,
    │     abortSignal: abortController.signal,
    │   })
    ├─ for await (const delta of textStream):
    │     accumulated += delta
    │     write SSE 'chunk' { delta }
    │
    ├─ on success:
    │     UPDATE games SET current_code = accumulated WHERE id = ?
    │     write SSE 'done' {}
    │
    ├─ on error (LLM API failure, not user abort):
    │     write SSE 'error' { message }
    │     (no row cleanup — placeholder game stays; user can delete)
    │
    └─ finally:
          activeStreams.delete(userId)
          reply.raw.end()
```

Module layout:

- `apps/server/src/services/llm/client.ts` — exports a configured
  `anthropic` provider instance and a `streamGame({ prompt, signal })`
  function returning the AI SDK's text stream.
- `apps/server/src/services/llm/prompts/generation.ts` — exports
  `GENERATION_SYSTEM_PROMPT` as a string. Hardcoded for this step;
  genre variants and RAG-injected examples land in steps 9–10.
  Path matches SPEC §13's commitment that prompt content lives in
  `apps/server/src/services/llm/prompts/`.
- `apps/server/src/lib/sse.ts` — `writeSSE(reply, event, data)` helper;
  formats `event: <name>\ndata: <json>\n\n` and flushes.
- `apps/server/src/lib/active-streams.ts` — exports a process-local
  `Set<string>` of active `userId`s, plus `acquire(userId)` /
  `release(userId)` helpers that throw a typed error on contention.
- `apps/server/src/routes/games.ts` — extended with the streaming
  branch on `POST /api/games`. The row-creation logic from step 3
  is reused as the first action inside the handler.

### Client side

```
/game/new route component
    │
    ├─ <PromptInput onSubmit={startGeneration} />
    │
    └─ useStreamedGeneration() hook
         ├─ AbortController per request
         ├─ fetch('/api/games', { method:'POST', body, signal,
         │                        credentials:'include' })
         ├─ reader = response.body.getReader()
         ├─ TextDecoder + line buffer; parse SSE frames
         │   (event: <name>\ndata: <json>\n\n)
         ├─ on 'meta':  history.replaceState(null, '', `/game/${gameId}`)
         │              setGameId(gameId); setTitle(placeholderTitle)
         ├─ on 'chunk': setCode(prev => prev + delta)
         ├─ on 'error': setStatus('error'); setError(message)
         └─ on 'done':  setStatus('idle')

GameIframe component
    ├─ injectWrapper(rawCode) — appends the §9 error postMessage script
    │   inside a final <script> tag before </body> (or appended if no
    │   </body> present, since streaming may show partial markup)
    └─ <iframe srcdoc={withWrapper} sandbox="allow-scripts" />

StopButton
    └─ calls AbortController.abort() from the hook
```

Component layout:

- `apps/web/src/routes/game.new.tsx` — file-based route. On submit,
  invokes the streaming hook. Renders `<BuilderLayout>` with
  `<ChatPanel>` left and `<GamePane>` right.
- `apps/web/src/routes/game.$id.tsx` — file-based route. For this step,
  reuses the same `<BuilderLayout>`. Loads existing game via
  `GET /api/games/:id` (already exists from step 3) when the route is
  hit directly (not via `replaceState` from `/game/new`). When arrived
  at via `replaceState` mid-stream, the existing component instance is
  preserved by `replaceState` — no remount, no fetch.
- `apps/web/src/hooks/useStreamedGeneration.ts` — the streaming hook.
  ~50 lines. Parses SSE manually; SPEC §12 explicitly notes that the
  AI SDK's `useChat` does not match our schema.
- `apps/web/src/components/builder/GameIframe.tsx` — wraps the iframe,
  injects the wrapper script, listens to `window.message` for
  `game-error` (logs to console only in this step).
- `apps/web/src/components/builder/StopButton.tsx` — visible only while
  `status === 'streaming'`, calls the abort handler.
- `apps/web/src/components/builder/StatusOverlay.tsx` — "Generating..."
  pill over the iframe while streaming.
- `apps/web/src/lib/iframe-wrapper.ts` — exports
  `WRAPPER_SCRIPT` (the §9 snippet) and `injectWrapper(html)`.
  SPEC §9 is the canonical source of truth for this file's path
  and contents; it declares this as the single canonical wrapper
  file. Future steps (5 thumbnail capture, 11 repair) extend the
  same file rather than introducing parallel wrappers.

## Key decisions

### SSE over WebSocket

Generation is unidirectional server→client. SSE is one-way, works over
plain HTTP, requires no protocol upgrade, and matches §11's documented
event schema. WebSockets would add bidirectional capability we don't
need and require a separate plugin. This also matches the rest of the
streamed endpoints (refine, repair) in §11 — using SSE for one and WS
for the others would split the client streaming code.

### `fetch` + `ReadableStream` reader, not `EventSource`

`POST /api/games` carries the prompt in the request body. `EventSource`
is GET-only and cannot send a body. SPEC §12 calls this out
explicitly. The `fetch` + reader path is ~30–50 lines and gives us
access to the `AbortSignal` for cancellation, which `EventSource`
doesn't expose cleanly.

### Client-side wrapper injection, not server-side persistence

SPEC §12 mandates: "Server stores only the LLM's raw output as
`current_code`; the wrapper is never persisted." Reasons:

- The wrapper is a client/runtime concern (it talks to `parent`,
  i.e. the builder window). Persisting it would couple stored game
  code to a specific iframe-host contract.
- If the wrapper changes (more error types, telemetry hooks), every
  stored game would need migration.
- A user exporting their game (a future feature) gets the clean
  LLM output, not our scaffolding.

The cost is ~10 lines of string concatenation on every iframe render.
Cheap.

### Hardcoded prompt at this stage

SPEC §19 step 4 says "hardcoded Sonnet prompt (no RAG, no
classification)". This isolates the streaming/iframe/cancellation
machinery from the retrieval/classification machinery. If something
breaks in step 9 (RAG) we know the streaming layer is solid. The
prompt file (`apps/server/src/services/llm/prompts/generation.ts`)
lives at the path SPEC §13 commits to, so step 9–10 just extend the
prompt-building function — no file moves.

### Process-local `Set<userId>` for concurrency

SPEC §14 mandates 1 active stream per user, tracked in-memory. A
single Bun/Fastify process is the prototype's deployment model
(SPEC §2 — "no production deployment, no multi-instance scaling"),
so process-local is correct. A future multi-instance build would
swap this for Redis; the `acquire`/`release` interface is stable.

### Game row created before LLM call

SPEC §7 and §12 both require the row to exist before streaming
starts so the `meta` event can carry a real `gameId` and the client
can `replaceState`. Failure modes:

- LLM call fails before any chunks arrive → row remains with
  `current_code = ''`. User sees the placeholder title in their
  dashboard (step 5). They can delete it. Acceptable for the
  prototype; no automatic cleanup.
- User aborts mid-stream → row keeps whatever `current_code` had
  been accumulated and persisted at abort time. We persist on
  successful completion only, so an aborted stream leaves
  `current_code = ''`. SPEC §14 says credits are not refunded on
  cancel; here, with no credits yet, the only artifact is an empty
  game row. Same delete path.

### `meta` event carries placeholderTitle, not final title

SPEC §11 explicitly: "Sent immediately after game row creation,
before any LLM work. Final title arrives later when title generation
completes". In this step, no GPT-4.1-mini title call exists, so the
placeholder (`prompt.slice(0, 40)`) is also the final title until
step 10 wires up generation.

## Open questions

- **Backpressure on chunk events.** Sonnet emits ~4K output tokens
  in 5–15s; SSE writes to `reply.raw` are unbounded buffers. For the
  prototype on localhost this is a non-issue. Flagging for revisit
  if streaming feels janky.
- **Line-buffered SSE parsing on the client.** The `fetch` reader
  yields arbitrary `Uint8Array` chunks that may split mid-frame.
  We need a small line-buffer accumulator. The hook owns this.
- **Resuming a disconnected stream.** Out of scope — if the network
  drops, the user retries. SPEC doesn't promise resumability.
- **iframe wrapper injection during streaming partial HTML.** While
  chunks accumulate, the HTML is incomplete (no `</body>` yet).
  Reassigning `srcdoc` on every chunk causes the iframe to re-parse
  and re-execute scripts repeatedly, which is undesirable. Decision:
  during streaming, do **not** update the iframe; show the
  `StatusOverlay` and the streaming code in the chat panel's
  collapsible code block (SPEC §12 left pane — "Streaming code
  visible during generation"). On `done`, inject the wrapper into
  the final HTML and assign `srcdoc` once. This also matches §9
  "Hard reload — replacing srcdoc re-runs the game from scratch".
- **What event triggers iframe assignment?** Confirmed by the
  decision above: the `done` SSE event. The iframe is empty (no
  `srcdoc`) until then.

### Resolved decisions

- **Prompt max length.** Standardized at `z.string().min(1).max(2000)`
  for consistency with step 03's plan. Step 04's earlier `max(4000)`
  draft is dropped; SPEC is silent on the cap so internal consistency
  wins.

## Acceptance criteria

1. With `ANTHROPIC_API_KEY` set, navigating to `/game/new`, typing a
   prompt (e.g. "a simple breakout clone"), and submitting:
   - URL changes to `/game/:id` within ~1s of submit (the `meta`
     event arrives before the first `chunk`).
   - Streaming HTML is visible in a collapsible code block in the
     left chat panel as it arrives.
   - On stream completion, the iframe on the right renders a
     playable game.
   - `games.current_code` in SQLite contains the full HTML.
   - `messages` table has one row with `kind='prompt'` and the
     submitted text.
2. Clicking the **Stop** button mid-stream:
   - Aborts the `fetch`.
   - Server logs the disconnect; the AI SDK stream is aborted.
   - `activeStreams` set no longer contains the user.
   - Iframe stays empty (no partial render). User can submit a new
     prompt immediately.
3. Submitting a second prompt while the first is streaming (e.g.
   from a second browser tab):
   - Returns HTTP 409 with body
     `{ error: 'A generation is already in progress' }`.
   - First stream is unaffected.
4. Killing the LLM call (e.g. invalid `ANTHROPIC_API_KEY`):
   - Server emits an SSE `error` event with a useful message.
   - Client surfaces the error in the status overlay.
   - `activeStreams` is cleared.
5. Reloading `/game/:id` after a successful generation:
   - `GET /api/games/:id` (from step 3) returns the persisted code.
   - Iframe renders the saved game.
   - No re-streaming.
6. The wrapper script's `error` and `unhandledrejection` listeners
   exist on `window` inside the iframe (verifiable by deliberately
   throwing from the generated game and observing a `game-error`
   `postMessage` in the parent's `message` listener — even though
   the parent only logs in this step).
7. Submitting a prompt at `/game/new` causes the URL to swap to
   `/game/:id` via `history.replaceState` with NO React tree remount:
   a state value set in the builder component before `meta` arrives
   is still present after the URL swap.
