# 11 — Auto-Repair Loop — Implementation Plan

Implements the design in `docs/designs/11-auto-repair.md`. Grounded in
SPEC §3, §5, §7, §9, §10, §11, §12, §13, §14.

## Pre-flight

Confirm the following before starting. Stop and resolve if anything is
missing.

- **Step 4 complete.** `POST /api/games` streams Sonnet output via
  `meta`/`chunk`/`done`/`error` SSE events. The iframe wrapper script
  (SPEC §9) is injected client-side via
  `apps/web/src/lib/iframe-wrapper.ts` before every `srcdoc`
  assignment. The `acquire(userId)` / `release(userId)` concurrency
  Set lives in `apps/server/src/lib/active-streams.ts`. The parent
  builder already has a `message` listener that logs `game-error`
  events but takes no further action (per step 4 design). The Sonnet
  streaming helper is exported from
  `apps/server/src/services/llm/client.ts`.
- **Step 5 complete.** `POST /api/games/:id/thumbnail` exists and the
  client-side capture path triggers on stream `done`. We will reuse
  it on repair `done`.
- **Step 6 complete.** `POST /api/games/:id/refine` works end-to-end
  with the same SSE schema. The shape of the route handler (acquire →
  log row → meta → stream → persist → finalize) is the template for
  `/repair`. The persistent prompt input at the bottom of the chat
  panel exists and is the target of the **Refine** fallback CTA.
- **Step 7 complete.** `usage_log` table exists per SPEC §5 with the
  `(user_id, created_at)` index. The schema already permits
  `action='repair'` and `credits_charged=0`. No charge service
  involvement is needed for repair, but the table must be present.
- `packages/shared/src/models.ts` exposes the pinned model IDs
  (`gpt-4.1-mini`, `claude-sonnet-4-6`) per SPEC §3.

If step 7 has not landed yet, this step is blocked: writing repair
rows to a non-existent `usage_log` table is not viable, and adding
the table outside step 7 would duplicate the migration.

## Ordered tasks

### 1. Re-verify both wrapper handlers from SPEC §9

`apps/web/src/lib/iframe-wrapper.ts` is the single canonical wrapper
file per SPEC §9 and carries two required handlers:
`error`/`unhandledrejection` (added in step 4) and the
`capture-thumbnail` `message` listener (added in step 5). Both must
keep working after step 11's changes — re-verify here before
building the repair lifecycle on top.

- Manually edit a generated game's HTML in DevTools (or temporarily
  hard-code a broken game) and trigger:
  - `throw new Error('boom')` inside `gameLoop` → expect a `message`
    event in the parent with `data.type === 'game-error'`,
    `message: 'boom'`, `stack` populated.
  - `Promise.reject('async-boom')` from inside `init` → expect a
    `message` event with `data.type === 'game-error'` and
    `message: 'async-boom'`.
- Combined verification line: throw an error in DevTools →
  `game-error` postMessage fires AND fire
  `postMessage({type: 'capture-thumbnail'})` from the parent →
  `thumbnail` postMessage fires. Both must work after step 11
  changes.
- If any case fails, fix the wrapper string in
  `apps/web/src/lib/iframe-wrapper.ts` to match the SPEC §9
  contract. Commit the fix as a separate change before proceeding;
  this is step 4 / step 5 maintenance, not new step 11 surface.

### 2. Repair system prompt

- Create `apps/server/src/services/llm/prompts/repair.ts` exporting
  `REPAIR_SYSTEM_PROMPT`. Mirror the layout of
  `prompts/refinement.ts` from step 6.
- Build on the SPEC §13 base contract (single complete HTML file, no
  fences, canvas/init/update/render/gameLoop, etc.). Add repair-
  specific instructions per the design doc:
  - "You are repairing a single-file HTML5 canvas game that crashed
    at runtime. Preserve all user-visible behavior. Fix only the bug
    reported below."
  - "Permitted to rewrite the broken function or section if surgical
    patching is unsafe."
  - A slot for the categorized error type used as guidance.
- Export both the static system-prompt string and a small builder
  `buildRepairUserMessage({ originalPrompt, category, message,
  stack, code })` returning the user-message body shape from the
  design doc:

  ```
  Original prompt: "<originalPrompt>"
  Error category: <category>
  Error message: "<message>"
  Stack trace: <stack ?? "(none provided)">

  Current code:
  <code>
  ```

  Keep the builder pure and unit-testable.

### 3. Error categorizer

- Create `apps/server/src/services/llm/categorize-error.ts` exporting
  `categorizeError({ message, stack? }): Promise<{ category: 'syntax'
  | 'runtime' | 'logic' }>`.
- Implementation: single GPT-4.1-mini structured-output call (JSON
  mode). Prompt the model to pick one of the three labels given the
  error message and optional stack trace. Match the genre-classifier
  shape from step 10 if it has landed; otherwise model the call after
  any existing GPT-4.1-mini wrapper in
  `apps/server/src/services/llm/client.ts`.
- On malformed JSON, invalid label, or thrown error: return
  `{ category: 'runtime' }` and log a WARN with the raw response
  and the original error. Do not retry. SPEC §6 fallback pattern.
- Add a brief inline comment quoting SPEC §3 / §7 to ground the
  default-on-failure behavior.

### 4. LLM client: `streamRepair` helper

- In `apps/server/src/services/llm/client.ts`, add
  `streamRepair({ system, userMessage, signal })` returning an async
  iterable of string deltas. Mirror the existing
  `streamGame` / `streamRefinement` helpers (step 4 / step 6).
  No new transport — same Sonnet streaming call shape.
- If the existing client already has a generic `streamSonnet` that
  takes `{ system, userMessage, signal }`, reuse it instead of
  duplicating. The repair-specific bits all live in the prompt
  module, not in the LLM client.

### 5. Repair-log helper

- Create `apps/server/src/services/usage/repair-log.ts` exporting:
  - `async function logRepair(userId, gameId): Promise<{ logId: string }>`
    — inserts a `usage_log` row with `action='repair'`,
    `credits_charged=0`, `succeeded=0`, `game_id=gameId`,
    `user_id=userId`, fresh uuid, `created_at=Date.now()`. Returns
    `logId`.
  - `async function markRepairSucceeded(logId): Promise<void>` —
    sets `succeeded=1`. Idempotent.
- Do not touch `credits_remaining_*` here. Repair never decrements
  counters (SPEC §10). Do not call `applyResets` either — repair is
  not a charged action and does not need to gate on counter state.
- Note in a top-of-file comment: "Repair bypasses the charge service
  in `usage/charge.ts` because repairs are free per SPEC §10. The
  log row is for observability only (SPEC §5, §17)."

### 6. Route handler: `POST /api/games/:id/repair`

In `apps/server/src/routes/games.ts`, add the handler. Structure
mirrors `/refine` from step 6.

- **Body schema (Zod):**
  ```ts
  z.object({
    error: z.object({
      message: z.string().min(1).max(2048),
      stack: z.string().max(16384).optional(),
    }),
  })
  ```
  Validation failure → 400 (existing Fastify+Zod plugin behavior).
- **Auth + ownership:** Better Auth session middleware (already on
  `/api/*` per SPEC §14). Look up `games.id`; 404 if missing or
  `user_id !== session.user.id` (SPEC §14: "404 (not 403) on
  mismatch to avoid leaking existence").
- **Concurrency:** `acquire(userId)` from
  `apps/server/src/lib/active-streams.ts`. On contention throw the
  typed error → 409 with body
  `{ error: 'A generation is already in progress' }` (SPEC §14).
- **Open SSE stream:** set headers via the existing `writeSSE` /
  `openStream` helper from step 4. Write the `meta` event:
  `{ gameId: game.id, placeholderTitle: game.title }` (uniform with
  refinement, see step 6 design).
- **Insert log row:** `const { logId } = await logRepair(userId,
  game.id)`. Do this *after* `meta` is written so the log row
  ordering matches the user-visible repair start. Order is not
  strictly required but keeps logs and SSE timestamps aligned.
- **Categorize:** `const { category } = await categorizeError({
  message, stack })`. Soft-fail per task 3.
- **Build prompt + stream:**
  ```ts
  const userMessage = buildRepairUserMessage({
    originalPrompt: game.original_prompt,
    category,
    message,
    stack,
    code: game.current_code,
  });
  const ac = new AbortController();
  request.raw.on('close', () => ac.abort());
  for await (const delta of streamRepair({
    system: REPAIR_SYSTEM_PROMPT,
    userMessage,
    signal: ac.signal,
  })) {
    accumulated += delta;
    writeSSE('chunk', { delta });
  }
  ```
- **On stream completion (normal path):**
  - `await db.update(games).set({ current_code: accumulated,
    updated_at: Date.now() }).where(eq(games.id, id))`.
  - `await markRepairSucceeded(logId)`.
  - `writeSSE('done', {})`.
- **On AI SDK error (not abort):** `writeSSE('error', { message })`.
  Do NOT update `current_code`. Leave `succeeded=0`. No refund (cost
  is 0).
- **On abort (client close):** skip persist, skip `error` write
  (socket dead). Leave `succeeded=0`.
- **`finally`:** `release(userId)`.
- **Centralize finalize.** Use the same one-finalize-call invariant
  from step 7 / step 6: a single `finalize(outcome)` helper that
  writes the right SSE event and toggles `succeeded` exactly once.
  Re-use the helper from refinement if it was already factored out;
  otherwise inline a small repair-scoped one and revisit factoring
  in step 13 polish.

### 7. Client: `useStreamedRepair` hook

- Create `apps/web/src/hooks/useStreamedRepair.ts`. Mirror
  `useStreamedRefinement` from step 6.
- Signature: `useStreamedRepair({ gameId })` returning
  `{ start({ error }), stop(), status, code, error }`.
- `start({ error })` issues `POST /api/games/:gameId/repair` with
  `{ error }`, parses the SSE stream via the existing fetch+
  ReadableStream consumer (SPEC §12), surfaces the same
  `meta`/`chunk`/`done`/`error` callback shape.
- `AbortController` for cancellation. On unmount, abort.
- 409 response → throw a typed `ConcurrencyError` (already used in
  the generation/refinement hooks); the controller drops it (a
  repair while another stream is in flight is rare and self-
  resolving — when the prior stream ends, the iframe will throw
  again and we re-enter the lifecycle).
- 404 / 401 / 500 → throw a typed error so the controller can
  decide. Treat as a failed attempt for cap purposes.

### 8. Client: `RepairController` and parent `message` listener

- Create `apps/web/src/components/builder/RepairController.tsx`
  (or fold into an existing builder context if step 6 already has
  one). Owns `repairAttempt`, `status`, `lastError`, `brokenCode`.
- `useEffect` registers a `window.message` listener:
  ```ts
  function onMessage(e: MessageEvent) {
    const data = e.data;
    if (!data || data.type !== 'game-error') return;
    handleGameError({
      message: String(data.message ?? 'unknown error'),
      stack: typeof data.stack === 'string' ? data.stack : undefined,
    });
  }
  ```
  Filter by `e.source === iframeRef.current?.contentWindow` if a
  ref is available; otherwise the `data.type` filter is sufficient
  (the iframe is sandboxed and only our wrapper postMessages this
  shape).
- `handleGameError` lifecycle:
  - If `status !== 'idle'` → drop the event.
  - Capture `brokenCode = currentCode` (current code in builder
    state).
  - If `repairAttempt < 2`: set `status='repairing'`,
    `lastError={...}`, `repairAttempt → repairAttempt + 1`, call
    `useStreamedRepair.start({ error })`.
  - If `repairAttempt >= 2`: set `status='fallback'`,
    `lastError={...}`. Open the fallback dialog.
- On `useStreamedRepair` `done`: set `status='idle'`. Do NOT reset
  `repairAttempt` (per design — preserves cap across consecutive
  failures).
- On `useStreamedRepair` `error` event: if `repairAttempt < 2` set
  `status='idle'` and wait (the iframe will throw again). If
  `repairAttempt >= 2` set `status='fallback'`.
- Reset `repairAttempt = 0` on:
  - User submits a fresh refinement (step 6 flow) — listen on the
    same builder event/state.
  - User clicks **Try again** or **Refine** in the fallback
    dialog.
  - Successful generation completes (step 4 flow) — i.e. a new
    game's first stream `done`.

### 9. Client: status overlay extension

- Update `apps/web/src/components/builder/StatusOverlay.tsx` from
  step 4 to accept a `status: 'generating' | 'repairing' | 'idle'`
  prop. Map `'repairing'` to "Detected an error, fixing..." per
  SPEC §12.
- Builder mounts the overlay with the merged status from the
  generation/refinement hook *and* `RepairController.status`.
  Order of precedence (only one is true at a time given the
  concurrency cap): repairing > generating > idle.

### 10. Client: hide Stop button during repair

- `StopButton` from step 4 must NOT render during repair streams.
  The status overlay is read-only for repair (per design doc
  decision: repair is short and free, one less decision for the
  user). Gate visibility on `status === 'generating'` or
  `status === 'refining'` only, excluding `'repairing'`.
- Acceptance: the Stop button is not visible during repair
  streams. Verifiable by inducing a repair and inspecting the
  builder — no Stop control should be present while the
  "Detected an error, fixing..." overlay is showing.

### 11. Client: thumbnail recapture on repair `done`

- The step 5 thumbnail-capture path already fires on stream `done`
  for generation and refinement. Extend the trigger to fire on
  repair `done` too. If the trigger lives in a shared "post-stream
  finalize" effect keyed on stream identity, this is a one-line
  add. If thumbnail capture is hard-wired to specific hooks,
  add an explicit call after the repair stream resolves in
  `RepairController`.

### 12. Client: fallback dialog

- Create `apps/web/src/components/builder/RepairFallbackDialog.tsx`
  using shadcn `Dialog`. Props: `open`, `onClose`, `error: {message,
  stack?}`, `brokenCode: string`, `onTryAgain()`, `onRefine()`.
- Layout:
  - Header: "We couldn't fix this game automatically."
  - Body: monospace block with `error.message` truncated to 200
    chars (append `…` if truncated). Below it, an Accordion (or
    `<details>`) labeled "Show broken code" wrapping a scrollable
    `<pre><code>` block of `brokenCode`. Closed by default.
  - Footer: two primary buttons — **Try again** and **Refine** —
    plus a quiet **Close** affordance. No third "Discard" button
    (per design open-question resolution).
- If shadcn `Accordion` is not yet installed, install it (`bunx
  shadcn@latest add accordion`) — SPEC §12 lists a minimal set
  but explicitly permits adding "others as needed during build."
  Otherwise use plain `<details>`/`<summary>`.

### 13. Wire fallback CTAs

- **Try again:** in `RepairController`, `onTryAgain` does:
  - `setRepairAttempt(0)`; close dialog.
  - Read `game.original_prompt` from the game state already loaded
    in the builder.
  - Trigger the existing `useStreamedGeneration.start(prompt)` (or
    equivalent — whatever step 4 / step 5 use to kick a fresh
    generation against an existing game id). This charges credits
    per the step 4/7 flow (SPEC §9 — fresh generation).
  - The streaming UI takes over; the overlay flips back to
    "Generating...".
- **Refine:** `onRefine` does:
  - `setRepairAttempt(0)`; close dialog.
  - Focus the persistent prompt input at the bottom of the chat
    panel (existing element from step 6). Pass a ref or use a
    builder-scoped event bus, whichever pattern step 6 chose.
  - Do **not** pre-fill the input (per design open-question
    resolution). The user types their own feedback.

### 14. Confirm concurrency cap covers `/repair`

- After task 6 lands, manually verify by starting a generation,
  then while it streams firing a repair (e.g. via a second tab or
  a fabricated `game-error` from DevTools `parent.postMessage`).
  Expect 409.
- If `acquire`/`release` is invoked unconditionally at the top of
  the repair handler (per task 6), this is automatic. The
  verification just confirms there are no escape hatches.

### 15. Confirm cancellation works on repair stream

- During a repair, click navigate-away (or close the tab). Check
  server logs for `request.raw 'close'` event firing and the LLM
  abort signal triggering. The `usage_log` row stays at
  `succeeded=0`. The concurrency slot is released.

## Verification steps

Run each manually after the code is in place. Dev server running,
user signed in, at least one generated game in the dashboard.

1. **Inject a syntax error.** Use DevTools to edit the iframe's
   `srcdoc` source in-memory or temporarily modify the Sonnet output
   to introduce `throw new Error('test-syntax')` inside `gameLoop`.
   Reload the iframe via a refinement that intentionally produces a
   broken result, or directly hand-edit `current_code` in the
   database and refresh.
   - Expect: status overlay shows "Detected an error, fixing...".
   - Expect: `POST /api/games/:id/repair` fires with the error
     payload visible in network tab.
   - Expect: SSE `meta` then `chunk` events stream in.
   - Expect: on `done`, iframe re-renders; new `current_code` in
     the database; thumbnail updated.
   - Expect: one `usage_log` row with `action='repair'`,
     `credits_charged=0`, `succeeded=1`.
2. **Force two consecutive repair failures.** Temporarily break the
   server's Sonnet call inside the repair path (e.g. throw at the
   top of `streamRepair`, or set `ANTHROPIC_API_KEY=invalid` and
   restart). Trigger a `game-error` twice (the iframe still
   contains broken code, so it will re-throw).
   - Expect first error: overlay shows "fixing...", SSE `error`
     event delivered, overlay clears, `repairAttempt=1`.
   - Expect second error: overlay shows "fixing...", SSE `error`
     event delivered, `repairAttempt=2`.
   - Expect (on what would be the third event): fallback dialog
     opens with truncated message and collapsible code panel.
   - Expect: two `usage_log` rows with `action='repair'`,
     `credits_charged=0`, `succeeded=0`.
3. **Click Try again in the fallback dialog.**
   - Expect: dialog closes; overlay flips to "Generating..."; a
     fresh `POST /api/games` (or whatever existing
     fresh-generation endpoint targets the existing game id —
     reconfirm against step 4) runs against
     `games.original_prompt`.
   - Expect: credits decremented per step 7 flow (200 for a
     non-admin Free user).
   - Expect: a new generation `usage_log` row, separate from the
     repair rows.
   - Expect: `current_code` replaced with the new generation
     output; iframe renders the new game.
4. **Click Refine in the fallback dialog (separate run).** Force
   two repair failures again to reopen the fallback dialog. Click
   **Refine**.
   - Expect: dialog closes; the persistent prompt input at the
     bottom of the chat panel is focused with no pre-filled text.
   - Expect: typing feedback and submitting flows through the
     existing `/api/games/:id/refine` endpoint (step 6); a
     `messages` row with `kind='feedback'` is created; the
     refinement streams normally and replaces `current_code`.
   - Expect: refinement charges 150 credits per step 7.
5. **`usage_log` records succeed=1 on success, 0 on failure.**
   Cross-check the rows from runs (1) and (2) directly via
   `sqlite3 apps/server/data/arcadeai.db "SELECT action,
   credits_charged, succeeded, game_id FROM usage_log ORDER BY
   created_at DESC LIMIT 10"`. Expect the success row to have
   `succeeded=1` and the two failure rows to have `succeeded=0`,
   all with `credits_charged=0`.
6. **Concurrency 409 on repair.** Start a generation. While it
   streams, fire a synthetic `game-error` via DevTools
   `window.dispatchEvent(new MessageEvent('message', { data:
   { type: 'game-error', message: 'forced' } }))` in the parent.
   - Expect: the server returns 409 to the repair POST. The
     controller drops the error.
7. **Repair cancellation.** Trigger a real repair, then close the
   tab while chunks are still streaming.
   - Expect: server logs show the abort firing; concurrency slot
     released (a fresh request from the same user immediately
     after succeeds rather than 409); `usage_log` row stays
     `succeeded=0`; `current_code` unchanged.
8. **Categorizer fallback.** Set `OPENAI_API_KEY=invalid`, restart.
   Trigger a repair.
   - Expect: WARN log line about categorizer failure; repair
     proceeds normally; Sonnet receives `category='runtime'`
     in the prompt.
9. **No `messages` rows for repair.** After all the above, query
   `SELECT * FROM messages WHERE game_id = ?` for the test game.
   - Expect: only `kind='prompt'` and `kind='feedback'` rows. No
     repair-related entries (SPEC §5).
10. **Wrapper coverage for unhandled rejection.** Inject
    `Promise.reject('async-fail')` into the iframe (e.g. via a
    refinement that produces such code). Confirm the parent
    `message` listener fires with `data.type === 'game-error'`,
    `data.message === 'async-fail'`. If not, return to task 1.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — Server repair endpoint

After the server-side repair tasks complete (repair prompt, error categorizer, `streamRepair` helper, repair-log helper, `POST /api/games/:id/repair`, 2-attempt cap, concurrency cap, cancellation) and the pre-commit gate passes:

```
feat(repair): add repair endpoint with 2-attempt cap
```

Includes: `apps/server/src/services/llm/prompts/repair.ts`, `apps/server/src/services/llm/categorize-error.ts`, `apps/server/src/services/usage/repair-log.ts`, the `streamRepair` helper, and the `POST /api/games/:id/repair` handler.

### Checkpoint 2 — Repair UI + fallback

After the client-side tasks complete (`useStreamedRepair`, `RepairController`, parent `message` listener, status overlay extension, fallback CTAs) and the pre-commit gate passes:

```
feat(builder): wire repair UI overlay and fallback dialog
```

Includes: `useStreamedRepair` hook, `RepairController` component, parent-window message listener integration, status overlay extension, and the fallback-CTA dialog.

## Rollback notes

- **Additive surface.** All new files are additive:
  - `apps/server/src/services/llm/prompts/repair.ts`
  - `apps/server/src/services/llm/categorize-error.ts`
  - `apps/server/src/services/usage/repair-log.ts`
  - `apps/web/src/hooks/useStreamedRepair.ts`
  - `apps/web/src/components/builder/RepairController.tsx`
  - `apps/web/src/components/builder/RepairFallbackDialog.tsx`
- **Modified surface (small):**
  - `apps/server/src/routes/games.ts` — new `POST /api/games/:id/repair`
    handler block.
  - `apps/server/src/services/llm/client.ts` — possibly a
    `streamRepair` helper. If reused via a generic `streamSonnet`,
    no change.
  - `apps/web/src/components/builder/StatusOverlay.tsx` — new
    `'repairing'` status branch.
  - `apps/web/src/components/builder/StopButton.tsx` (or wherever
    visibility is gated) — exclude `'repairing'` from the visible
    set.
  - `apps/web/src/lib/iframe-wrapper.ts` — only modified if task 1
    verification finds a bug; otherwise untouched.
- **Schema:** no new tables, no new columns. `usage_log` already
  permits `action='repair'` from step 7. Rollback requires no
  migration.
- **Reverting the server alone** removes the repair endpoint;
  client-side repair POSTs will 404 and the controller will treat
  every error as a failed attempt, opening the fallback dialog
  after two iframe throws. The product remains usable; auto-repair
  is just disabled.
- **Reverting the client alone** leaves the repair endpoint
  reachable but unused. No traffic; no observable change to users
  (they see the same crash they always saw).
- **Partial rollback safety:** the wrapper script is unchanged from
  step 4; if step 11's parent listener is removed, behavior reverts
  to step 4 (parent logs `game-error` but does nothing else). Safe.
- **`usage_log` repair rows are non-destructive.** Rolling back
  step 11 leaves any rows already written intact; they're
  observability-only and do not affect counters or game state.

(End of file)
