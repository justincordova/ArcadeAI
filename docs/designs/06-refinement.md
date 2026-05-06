# 06 — Refinement

## Overview

Add `POST /api/games/:id/refine` (SPEC §11) so users can iterate on an
existing game via natural-language feedback. The endpoint persists the
feedback as a `messages` row with `kind='feedback'` (SPEC §5), builds the
refinement context per SPEC §16 (original prompt + bulleted history of
past user requests + current code, or a GPT-4.1-mini–summarized digest if
the current code estimates to >2000 tokens), invokes Claude Sonnet 4.6
with the refinement system prompt variant (SPEC §13 — full rewrite
permitted when feedback is incompatible), and streams the resulting HTML
back over SSE using the same `meta`/`chunk`/`done`/`error` schema as
generation (SPEC §11). On stream completion, the persisted
`games.current_code` is replaced and the client recaptures a thumbnail
(reusing step 5's capture path).

Refinement reuses the SSE helper, concurrency Set, abort wiring, and
iframe rendering machinery introduced in step 4. The only genuinely new
machinery is the context-builder service and the GPT-4.1-mini
summarization fallback.

## Goals

- New route handler `POST /api/games/:id/refine` with body
  `{ feedback: string }` (SPEC §11). Ownership-gated (404 on mismatch
  per SPEC §14).
- Persist the feedback verbatim as a `messages` row with
  `kind='feedback'` before any LLM work (SPEC §5).
- Build refinement context per SPEC §16:
  - System prompt — refinement variant (SPEC §13).
  - `Original prompt: "<games.original_prompt>"`.
  - `Past changes requested:` followed by a bulleted list of every
    prior `messages.content` for the game where `kind='feedback'`,
    ordered by `created_at` ascending. Excludes the just-inserted
    feedback (that is the "Current request").
  - `Current code:` — either the full `games.current_code` or a
    GPT-4.1-mini–produced structural digest if `current_code.length / 4
    > 2000` (SPEC §16). Char-based estimate; no tokenizer dependency.
  - `Current request: "<feedback>"`.
- Stream Sonnet output via the same SSE schema as generation
  (`meta`/`chunk`/`done`/`error`, SPEC §11). The `meta` event carries
  `{ gameId, placeholderTitle: games.title }` so the client schema is
  uniform across generation and refinement, even though the URL does
  not change on refinement.
- On stream completion, `UPDATE games SET current_code = ?,
  updated_at = ? WHERE id = ?`. The chat panel renders the new feedback
  message immediately on submit (SPEC §12 — left pane renders user
  messages from `messages`); the iframe `srcdoc` is replaced with the
  refined HTML on `done` (hard reload, SPEC §9).
- Trigger a thumbnail recapture from the iframe after the refinement
  stream completes successfully, reusing the capture path introduced in
  step 5 (SPEC §12 — "Thumbnails update only on successful
  generation/refinement completion"). No new endpoint; `POST
  /api/games/:id/thumbnail` from step 5 is reused as-is.
- Reuse step 4's concurrency Set (SPEC §14): refinement counts as an
  active stream for the user. A second concurrent request (any of
  generation/refinement/repair) returns 409.
- Reuse step 4's abort wiring: client `AbortController` + server
  `request.raw.on('close', ...)` cancels the LLM stream via the AI
  SDK's abort signal (SPEC §14). Credits not refunded on cancel —
  moot for this step (no credits yet) but the structural shape is
  preserved.
- Persistent prompt input at the bottom of the chat panel becomes the
  refinement input on `/game/:id` for already-generated games. Disabled
  during streaming (SPEC §12).

## Non-goals (explicitly deferred)

- **No credit deduction or `usage_log` writes.** SPEC §10 sets
  refinement at 150 credits, but credit bookkeeping is step 7. The
  refinement endpoint runs without any credit check or deduction in
  this step. Concurrency Set is the only gate.
- **No RAG retrieval in the refinement context.** SPEC §16's context
  recipe deliberately omits RAG examples for refinement, and step 9 is
  where RAG is wired into the generation path. Refinement does not
  retrieve a few-shot example.
- **No genre-aware system prompt variant.** A single refinement system
  prompt is used (SPEC §13). Genre-specific variants and
  classification arrive in step 10.
- **No auto-repair on refinement output.** If the refined game throws
  inside the iframe, the wrapper's `postMessage('game-error', ...)`
  fires (from step 4), but the client still does nothing with it. The
  repair endpoint (`POST /api/games/:id/repair`, SPEC §11) is step 11.
- **No version history.** SPEC §5 explicitly stores latest-only code.
  Refinement overwrites `games.current_code`. Past `current_code`
  values are not retained. `messages` history is the only audit trail.
- **No regenerate-from-original button changes.** SPEC §12 mentions a
  "Regenerate" control that re-runs the original prompt as a fresh
  generation; that lives in step 4's surface and is not modified here.

## Architecture

### Server side

```
POST /api/games/:id/refine  (Zod-validated body { feedback: string })
    │
    ├─ session check (existing from step 2)
    ├─ ownership check: SELECT games WHERE id=? AND user_id=?
    │     (404 if not owned — SPEC §14)
    ├─ acquire(userId)  (step 4's Set; 409 on contention)
    │
    ├─ insert messages row { game_id, kind:'feedback', content:feedback }
    │
    ├─ buildRefinementContext(game, feedback) → {
    │      systemPrompt,
    │      userMessage,   // the assembled "Original prompt + Past… + Current code + Current request" body
    │   }
    │     │
    │     ├─ load past messages for game where kind='feedback'
    │     │   AND id != just-inserted (or filter by created_at < insert ts)
    │     ├─ if game.current_code.length / 4 > 2000:
    │     │     digest = await summarizeCode(game.current_code)
    │     │     codeBlock = digest
    │     │   else:
    │     │     codeBlock = game.current_code
    │     └─ assemble per SPEC §16 template
    │
    ├─ reply.hijack(); writeSSEHeaders
    ├─ writeSSE('meta', { gameId, placeholderTitle: game.title })
    │
    ├─ AbortController; request.raw.on('close', () => ac.abort())
    │
    ├─ const { textStream } = streamText({
    │     model: anthropic(SONNET),
    │     system: REFINEMENT_SYSTEM_PROMPT,
    │     prompt: userMessage,
    │     abortSignal: ac.signal,
    │   })
    ├─ for await (const delta of textStream):
    │     accumulated += delta
    │     writeSSE('chunk', { delta })
    │
    ├─ on success:
    │     UPDATE games SET current_code = ?, updated_at = ?
    │     writeSSE('done', {})
    │
    ├─ on LLM error (not abort):
    │     writeSSE('error', { message })
    │     (current_code untouched — last good version remains)
    │
    └─ finally:
          release(userId); endSSE
```

Module layout:

- `apps/server/src/services/llm/prompts/refinement.ts` — exports
  `REFINEMENT_SYSTEM_PROMPT`. Path matches SPEC §13's commitment that
  prompt content lives in `apps/server/src/services/llm/prompts/`.
  Extends the §13 base contract; adds the refinement-specific
  instruction: "Preserve user-visible behavior unless feedback
  explicitly asks for a rewrite. Full rewrite permitted when feedback
  is fundamentally incompatible with current code."
- `apps/server/src/services/llm/summarize.ts` — exports
  `summarizeCode(html: string): Promise<string>`. Single GPT-4.1-mini
  call (`@ai-sdk/openai`, model id `MINI = 'gpt-4.1-mini'` from
  `packages/shared/src/models.ts`) with a fixed system prompt asking
  for a structural digest: function signatures, key constants, brief
  logic outline, no full code reproduction. Non-streaming
  (`generateText`); the digest is small.
- `apps/server/src/services/refinement/context.ts` — exports
  `buildRefinementContext({ game, feedback, pastFeedback })`. Pure
  string assembly per SPEC §16; calls `summarizeCode` only when the
  char-estimate threshold is crossed.
- `apps/server/src/services/llm/client.ts` — extend with
  `streamRefinement({ system, prompt, signal })` mirroring the
  step-4 `streamGame` shape. Same Sonnet model, different system
  prompt. (Alternatively keep one generic `streamSonnet` and have
  callers pass system + user — implementation detail; the SPEC is
  agnostic.)
- `apps/server/src/routes/games.ts` — add the `POST /:id/refine`
  handler. Reuses the existing ownership lookup, `acquire`/`release`
  helpers, SSE helpers, and AbortController pattern from step 4. The
  row-update step replaces an insert.

### Client side

```
/game/:id route component (existing from step 4/5)
    │
    ├─ ChatPanel (existing)
    │     ├─ renders messages from GET /api/games/:id (kind='prompt'
    │     │   and kind='feedback' alike, SPEC §12)
    │     └─ <PromptInput onSubmit={refine} disabled={isStreaming} />
    │
    ├─ useStreamedGeneration hook — extend or wrap into a
    │   useStreamedRefinement variant. Key differences from step 4:
    │     - POSTs to `/api/games/${id}/refine` with `{ feedback }`.
    │     - Does NOT replaceState (already on /game/:id).
    │     - On `meta`: optimistically append the feedback to local
    │       message list (or invalidate the GET /api/games/:id query
    │       so it refetches the persisted feedback row).
    │     - On `chunk`: accumulate streamed code in a separate
    │       `streamingCode` state for the chat-panel collapsible
    │       block (SPEC §12 left pane).
    │     - On `done`: replace `code` (which feeds iframe srcdoc)
    │       with the accumulated streamed code, clear streamingCode,
    │       trigger thumbnail recapture.
    │     - On `error`: leave existing iframe content in place.
    │
    └─ GameIframe (existing) — unchanged. The iframe is reassigned
       via the same `<iframe srcdoc={injectWrapper(code)}>` mechanism;
       changing `srcdoc` is a hard reload (SPEC §9).
```

Pragmatic implementation: factor step 4's `useStreamedGeneration` into
a shared `useStreamedSSE({ url, body, onMeta, onChunk, onDone, onError })`
primitive. `useStreamedGeneration` and `useStreamedRefinement` become
thin wrappers. This avoids duplicating the SSE-frame parser. The
existing hook from step 4 may already be close to this shape; if not,
this step does the small refactor.

Component layout:

- `apps/web/src/hooks/useStreamedRefinement.ts` — wraps the shared SSE
  primitive; exposes `{ status, streamingCode, error, refine(feedback),
  stop() }`. After `done`, calls the thumbnail-capture utility from
  step 5 and invalidates the `['game', id]` TanStack Query so any
  cached `messages` list refetches.
- `apps/web/src/routes/game.$id.tsx` — wire the prompt input to
  `refine` instead of (or in addition to) the step-4 generation flow.
  The same component handles both new-stream-arriving-via-replaceState
  (step 4) and refine-existing-game (step 6); a small mode flag
  decides which hook to invoke on submit. For an already-generated
  game (`code` is non-empty on load), submitting goes to `refine`. For
  a fresh `/game/new` arrival, submitting goes to generation.
- Chat-panel rendering: SPEC §12 left pane already commits to
  rendering user messages from `messages`. Step 5's dashboard work is
  unrelated; the chat panel from step 4 needs to be extended (if not
  already) to render `kind='feedback'` rows alongside `kind='prompt'`
  rows in `created_at` order, with implicit "→ Generated game"
  markers between them (SPEC §5 note, §12).

### Thumbnail recapture

SPEC §12: "Thumbnails update only on successful
generation/refinement completion". Step 5 introduced the capture
utility (canvas → base64 PNG → `POST /api/games/:id/thumbnail`).
Refinement reuses it verbatim:

- After the SSE `done` event arrives and the iframe has been
  reassigned with the new `srcdoc`, wait the same delay step 5 uses
  (~2s per SPEC §7) for the iframe's first render frame, then call
  the existing capture function. No server changes; no new endpoint.

## Key decisions

### Bulleted list of past user prompts, not full message objects

SPEC §16: "History is a bulleted list of user prompts, not full
message objects. Cheap intent context."

Reasons:
- The model only needs to know *what the user asked for* to
  reconstruct intent. It does not need timestamps, IDs, or assistant
  outputs (the assistant output is the current code, which is sent
  separately).
- Bulleting is ~5–20 tokens per past request vs ~100+ tokens for a
  full message-with-metadata representation. Refinement happens many
  times per game; this is the difference between $0.05 and $0.10 per
  refinement at scale (SPEC §18).
- The current code already encodes the cumulative effect of all past
  changes — the bulleted history is purely for *intent* context, not
  state. Sending more would be redundant.

### No past code versions sent

SPEC §16: "No past code versions sent. The current code already
encodes all past changes — re-sending old versions is redundant token
spend."

Latest-only is also what the schema stores (SPEC §5 — no version
history table). Even if we wanted to send past versions, we don't
have them.

### Char-based token estimate (chars / 4) at threshold 2000

SPEC §16 is explicit: "estimated as `chars / 4` — no tokenizer
needed". Reasons:
- Avoids a tokenizer dependency for a yes/no decision. The estimate
  errs slightly high for HTML (which has lots of short tokens) but
  that's safe — we'd rather summarize when we don't strictly need to
  than ship 4K tokens of code without summarizing.
- 2000-token threshold matches SPEC §16 verbatim. Below this, the
  full code easily fits with the system prompt and history under the
  Sonnet input budget for a refinement turn (SPEC §18 budgets ~3K
  input for generation including a RAG example, so refinement
  without RAG has comparable headroom).
- Above 2000 estimated tokens, summarizing into a structural digest
  costs ~$0.001 (GPT-4.1-mini, SPEC §18) and saves multiples of
  that on the Sonnet refinement call.

### Full rewrite permitted in the system prompt

SPEC §13: "grants permission to rewrite from scratch when feedback
is fundamentally incompatible with current code".

Reasons:
- Some feedback ("change the genre to platformer", "make it
  multiplayer") cannot be reached by patching. Forcing a patch path
  produces tortured Frankenstein output worse than a clean rewrite.
- The structure of generated games is small and self-contained
  (single file, ~3–4K tokens of output per SPEC §18) so rewriting is
  cheap. Stitching a rewrite into a "preserve unless asked" prompt
  costs the model permission, not tokens.
- The default still leans toward preservation ("Preserve
  user-visible behavior unless feedback explicitly asks for a
  rewrite") so casual tweaks don't trigger gratuitous rewrites.

### Reuse the concurrency Set across all stream types

SPEC §14: "Applies to `/api/games`, `/api/games/:id/refine`, and
`/api/games/:id/repair`."

A single `Set<userId>` covers all three. Reasons:
- The user can only watch one stream at a time anyway (single
  builder pane).
- Prevents pathological cases where a user fires a refine while a
  generation is mid-flight, causing two updates to fight over
  `current_code`.
- Identical contention behavior (409) keeps the client error path
  uniform.

### Iframe hard-reload on refinement, not hot-swap

SPEC §9: "Hard reload — replacing `srcdoc` re-runs the game from
scratch. No hot-swap."

Reasons:
- Hot-swap would require a stable contract for game-state migration
  across versions, which doesn't exist (the LLM may rename functions,
  reshape state, etc.).
- A hard reload guarantees the new game runs with a clean module
  graph and avoids zombie listeners or rAF loops from the old
  version.
- Same UX as step 4's first-generation render: user already
  understands "watch it boot". No new mental model.

### `meta` event also emitted on refinement (with the same shape)

SPEC §11 documents `meta` as the leading event for streamed
endpoints. Refinement does not need the `gameId` (the URL already
encodes it) or a fresh title (the title doesn't change on refine),
but emitting `meta` keeps the SSE schema uniform across endpoints.
The shared client SSE primitive parses one schema; both
generation and refinement feed it.

The `placeholderTitle` field in the refinement `meta` event is the
existing `games.title`. The client already has it from
`GET /api/games/:id`; the field is included for schema parity, not
because it conveys new information.

## Open questions

- **Optimistic message append vs query invalidation.** On `meta`,
  the client could either (a) optimistically append the just-sent
  feedback to its local message list, or (b) invalidate the
  `['game', id]` query and let TanStack Query refetch. (a) is
  faster-feeling but risks divergence on server rejection; (b) is
  simpler but has a brief flash. Current decision: invalidate on
  `done`, not on `meta`. The chat panel can render an optimistic
  pending bubble (the just-typed feedback) until refetch resolves;
  this matches SPEC §12's "implicit '→ Generated game' markers"
  pattern. Revisit if the flash is noticeable.
- **Summarization cache.** Each refinement re-summarizes the same
  `current_code` if it crosses the threshold. A naive cache keyed
  on `current_code` hash would save ~$0.001 per repeat refinement
  on the same code version. Skipping for now — premature
  optimization for the prototype.
- **Concurrency error UX on refinement.** If the user clicks the
  refine submit while another stream is somehow active (shouldn't
  happen — input is disabled — but defensively), the 409 should
  surface as a toast. Step 4's error path may already handle this;
  audit during implementation.
- **Empty feedback / whitespace-only feedback.** Zod validation
  with a min-length-after-trim rule rejects this with a 400 before
  any DB write or LLM call. Consistent with step 4's `prompt`
  validation.
- **What happens if `current_code` is empty (refining a never-generated
  game)?** Should not occur — refinement is only available for games
  with non-empty `current_code`. The server still defends with: if
  `current_code === ''`, return 400 "Game has no code yet". Frontend
  hides the refinement input until the first generation completes.

## Acceptance criteria

1. With a generated game open at `/game/:id`, typing a refinement
   ("make the paddle bigger") into the prompt input and submitting:
   - The new feedback message appears in the chat panel (either
     optimistically or after `meta` triggers a refetch).
   - SSE `meta` arrives within ~1s.
   - Streaming HTML is visible in the chat panel's collapsible code
     block during the stream.
   - On `done`, the iframe `srcdoc` is replaced and the refined game
     renders.
   - SQLite check: `messages` has a new row with `kind='feedback'`
     and the verbatim text; `games.current_code` has been replaced;
     `games.updated_at` has advanced.
   - The thumbnail capture path from step 5 fires after the iframe
     re-renders; `games.thumbnail` is updated.
2. With `games.current_code` artificially padded so
   `length / 4 > 2000` (e.g. via a large generation or by inserting
   a comment block via SQL), submitting any refinement:
   - The refinement endpoint logs (or otherwise observably) that the
     summarization branch ran.
   - GPT-4.1-mini is invoked exactly once for the refinement turn.
   - The Sonnet call's input does NOT contain the full
     `current_code`; it contains the digest.
   - The resulting refinement still produces a valid game.
3. Submitting a refinement while a generation or another refinement
   is already streaming for the same user:
   - Returns HTTP 409 with body
     `{ error: 'A generation is already in progress' }` (SPEC §14
     verbatim).
   - The in-flight stream is unaffected.
4. Clicking **Stop** mid-refinement:
   - Aborts the `fetch`.
   - Server detects close, AI SDK stream aborts.
   - `games.current_code` is unchanged from before the refinement.
   - `messages` still has the feedback row (we persist before
     streaming).
   - User can submit a new refinement immediately.
5. LLM API failure during refinement (e.g. forced 500):
   - SSE `error` event arrives.
   - Iframe is unchanged (still showing the previous good game).
   - `games.current_code` is unchanged.
   - `activeStreams` is cleared.
6. Reloading `/game/:id` after a successful refinement:
   - `GET /api/games/:id` returns the refined `current_code` and the
     full `messages` history (prompt + every feedback so far).
   - Chat panel renders all user messages in `created_at` order.
   - Iframe renders the latest refined game.
