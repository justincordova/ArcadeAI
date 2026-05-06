# 11 — Auto-Repair Loop

## Overview

Step 11 adds the auto-repair pipeline defined in SPEC §7, §9, §11, §12.
When a generated game throws an uncaught exception or unhandled promise
rejection inside the sandboxed iframe, a wrapper script (already injected
client-side per step 4 / SPEC §9) `postMessage`s a `game-error` payload
to the parent window. The builder catches it, shows a "Detected an
error, fixing..." overlay (SPEC §12), and POSTs to
`/api/games/:id/repair` with `{ error: { message, stack } }` (SPEC §11).
The server categorizes the error with GPT-4.1-mini (SPEC §3), invokes
Claude Sonnet 4.6 with the repair-variant system prompt (SPEC §13),
streams replacement HTML over SSE using the same `meta`/`chunk`/
`done`/`error` schema as generation, and writes a `usage_log` row with
`action='repair'` and `credits_charged=0` (SPEC §5, §10). Repairs are
free — the model failed, not the user (SPEC §10, §17). A client-side
counter caps attempts at 2 per error chain (SPEC §9). After two
consecutive repair failures, the builder surfaces a fallback dialog
with a truncated message, a collapsible code panel, and two CTAs:
**Try again** (re-runs the original prompt as a fresh generation) and
**Refine** (treats the error as a refinement turn, SPEC §9). The 1-
concurrent-streaming-request-per-user cap from SPEC §14 also covers
`/repair`.

## Goals

- Wire the existing iframe `postMessage('game-error', ...)` channel
  (injected in step 4 per SPEC §9) into a builder listener that drives
  the repair lifecycle.
- New route handler `POST /api/games/:id/repair` (SPEC §11) with body
  `{ error: { message: string, stack?: string } }`. Ownership-gated
  (404 on mismatch per SPEC §14).
- Categorize the error via GPT-4.1-mini (SPEC §3, §7) into one of
  `syntax | runtime | logic` and pass the category to the repair
  system prompt as guidance.
- Stream replacement HTML from Claude Sonnet 4.6 using the
  repair-variant system prompt (SPEC §13). Re-use the same SSE schema
  (`meta`/`chunk`/`done`/`error`, SPEC §11). On `done`, persist
  `games.current_code` and recapture a thumbnail (SPEC §12).
- Write a `usage_log` row with `action='repair'`, `credits_charged=0`,
  `succeeded=0` at request entry; flip `succeeded=1` on successful
  stream completion. No counter mutation — admins behave identically
  here (SPEC §5, §10).
- Builder UI: status overlay text changes to "Detected an error,
  fixing..." during a repair stream (SPEC §12).
- Client-side attempt counter: track consecutive repair attempts per
  error chain. Reset on a successful play (next `done` event from any
  stream) or on user navigation. After the 2nd failed attempt, show
  the fallback dialog instead of triggering a 3rd repair (SPEC §9).
- Fallback dialog: truncated `message` (first ~200 chars) + collapsible
  panel showing the broken code + **Try again** and **Refine** CTAs
  (SPEC §9).
- **Try again** runs `POST /api/games` with the original prompt
  (SPEC §9 — "re-runs original prompt"). This is a fresh generation,
  charges credits, replaces `games.current_code` (existing behavior:
  refer to step 4 — generation overwrites the row's code).
- **Refine** opens the chat panel's persistent prompt input
  pre-focused; the user types feedback that gets sent through the
  existing refinement turn from step 6 (SPEC §9).
- Reuse the step 4 concurrency Set: a repair counts as an active
  stream; a second concurrent request (any of generation / refinement
  / repair) returns 409 (SPEC §14).
- Reuse step 4 / step 6 abort wiring. Client `AbortController` +
  server `request.raw.on('close', ...)` cancel the LLM stream via the
  AI SDK abort signal (SPEC §14). Credits are not refunded on cancel
  — moot for repair (cost is 0) but the lifecycle shape stays uniform.

## Non-goals

- **Detecting silent failures.** Black canvas, no rAF, frozen game
  loop — none of these trigger repair. SPEC §9 is explicit:
  "Silent failures (black canvas, no rAF) are not auto-detected — too
  many false positives kill UX more than the bug does." Hard crashes
  only.
- **Detecting logic bugs.** "Ball goes through paddle" is a
  refinement, not a repair (SPEC §9). The user surfaces these via the
  refinement input.
- **>2 repair attempts.** Hard cap at 2 consecutive attempts per
  error chain (SPEC §9). Beyond that the fallback dialog takes over.
- **Server-side attempt tracking.** The counter lives on the client
  (see Key decisions). The server has no awareness of "this is the Nth
  repair" — every `/repair` request is a fresh, free, single-attempt
  run from the server's perspective.
- **Credit charging on repair.** Always 0 (SPEC §10). The `usage_log`
  row exists purely for observability (SPEC §5, §17).
- **Repair queueing.** If a repair is in flight and another error
  fires (e.g. from a stale iframe handle), the second error is
  dropped, not queued. The concurrency cap (SPEC §14) makes the
  second request fail anyway; ignoring it on the client avoids a
  noisy retry loop.
- **Persisting a `messages` row for repairs.** SPEC §5 explicitly
  excludes auto-repair from the chat history: "Auto-repair attempts
  are NOT stored as messages (they're already tracked in `usage_log`
  with action='repair')."
- **New iframe wrapper script.** The `error` /
  `unhandledrejection` listeners were injected in step 4 (SPEC §9).
  This step only adds the parent-side listener and the
  request/response machinery on top.

## Architecture

### Iframe wrapper script (already injected, verified here)

Per SPEC §9 and the step 4 design, every iframe gets this script
appended client-side before `srcdoc` assignment:

```js
window.addEventListener('error', (e) => {
  parent.postMessage(
    { type: 'game-error', message: e.message, stack: e.error?.stack },
    '*'
  );
});
window.addEventListener('unhandledrejection', (e) => {
  parent.postMessage(
    { type: 'game-error', message: String(e.reason) },
    '*'
  );
});
```

Step 4 only logs the message in the parent. Step 11 adds the real
listener and verifies that both error sources fire correctly (deferred
verification from step 4's acceptance criteria, see step 4 design line
~316). No change to the wrapper string itself unless verification
turns up a missing case.

### Builder: parent `message` listener + repair lifecycle

`apps/web/src/components/builder/RepairController.tsx` (or a hook
mounted in the existing builder route) owns the lifecycle:

- `useEffect` registers a `window.message` listener on mount;
  filters for `data?.type === 'game-error'` and ignores all other
  origins/types.
- State: `repairAttempt: number` (0..2), `status: 'idle' | 'repairing'
  | 'fallback'`, `lastError: { message, stack? } | null`,
  `brokenCode: string | null`.
- On `game-error`:
  - If `status !== 'idle'`, drop the event (a repair is already
    underway, or the fallback dialog is open).
  - Capture current `games.current_code` into `brokenCode` (the
    fallback dialog shows the *broken* version).
  - If `repairAttempt < 2`: set `status='repairing'`, increment
    `repairAttempt`, kick off `useStreamedRepair` with the error
    payload.
  - If `repairAttempt >= 2`: set `status='fallback'`. Open the
    fallback dialog.
- On repair stream `done`: confirm the new HTML is loaded into the
  iframe (the existing iframe-render path on `done` from step 4
  applies — wrapper re-injected, hard reload). Status returns to
  `'idle'`. **Do not reset `repairAttempt`** here — a second crash
  immediately after a "successful" repair should still count toward
  the cap. `repairAttempt` is reset only when the user submits a new
  generation or refinement (i.e. enters a fresh user-driven turn).
- On repair stream `error` (terminal SSE error event from server):
  treat as a failed attempt. If `repairAttempt < 2`, go back to
  `'idle'` and wait for the iframe to throw again (it will, since the
  code wasn't replaced). If `repairAttempt >= 2`, open the fallback
  dialog.

The "wait for the iframe to throw again" model handles the case where
a repair stream errors out without producing replacement HTML: the
user's iframe still contains broken code, which will throw on next
animation frame, which fires another `game-error`, which the
controller now sees with `repairAttempt === 2` and routes to the
fallback dialog. This avoids a separate "force-fail" code path on the
client.

### Status overlay

`apps/web/src/components/builder/StatusOverlay.tsx` (from step 4)
gains a third state. Existing states: `'generating'` ("Generating..."),
`'idle'` (hidden). New state: `'repairing'` ("Detected an error,
fixing...") per SPEC §12. The overlay reads `status` from the
`RepairController` (lifted to a parent context or builder store).

### `useStreamedRepair` hook

`apps/web/src/hooks/useStreamedRepair.ts` — mirrors
`useStreamedGeneration` and `useStreamedRefinement` from steps 4 and
6. Same `fetch`+`ReadableStream` SSE consumer (SPEC §12 — "EventSource
doesn't support POST"). `AbortController` for cancellation.
Body: `{ error: { message, stack? } }`. Surfaces the same
`meta`/`chunk`/`done`/`error` callback shape.

### Server: `POST /api/games/:id/repair`

`apps/server/src/routes/games.ts` — new handler. Pipeline:

1. Auth + ownership check (SPEC §14). 404 on mismatch.
2. Zod-validate body: `{ error: { message: string, stack?: string } }`
   with reasonable max lengths (e.g. message ≤ 2 KB, stack ≤ 16 KB —
   defense-in-depth, not a SPEC requirement).
3. `acquire(userId)` from the step 4 concurrency module. 409 on
   contention (SPEC §14).
4. Insert `usage_log` row: `action='repair'`, `credits_charged=0`,
   `succeeded=0`, `game_id=id`. Capture `logId`.
5. Open SSE stream. Write `meta` event:
   `{ gameId: game.id, placeholderTitle: game.title }` (uniform with
   generation/refinement schema, per step 6 design).
6. **Categorize** (parallel-eligible but tiny, kept sequential for
   simplicity): one GPT-4.1-mini structured-output call returning
   `{ category: 'syntax' | 'runtime' | 'logic' }` (SPEC §3, §7). On
   malformed JSON / API failure, default to `category: 'runtime'` and
   log a WARN (mirrors the genre-classification fallback pattern from
   SPEC §6).
7. Build the repair prompt context (see "Repair prompt" below).
8. `streamRepair({ system, prompt, signal })` — Sonnet streaming
   call, same shape as `streamRefinement` from step 6. Pipe deltas to
   the client as `chunk` events.
9. On stream completion: `UPDATE games SET current_code = ?,
   updated_at = ? WHERE id = ?`. Write `done` event. Mark
   `usage_log.succeeded = 1`. Trigger thumbnail recapture client-side
   on `done` (reuses the step 5 path).
10. On AI SDK error (not abort): write `error` SSE event. Leave
    `usage_log.succeeded = 0`. Do NOT update `current_code` (last
    broken version stays — the iframe will throw again, see
    "RepairController" above). No refund (cost is 0).
11. On client-close abort: skip persist, skip `error` event (socket
    dead). Leave `usage_log.succeeded = 0`. `release(userId)` always
    runs in a `finally`.

### Repair prompt

`apps/server/src/services/llm/prompts/repair.ts` — exports
`REPAIR_SYSTEM_PROMPT`. Builds on the SPEC §13 base contract. Adds
repair-specific instructions:

- "You are repairing a single-file HTML5 canvas game that crashed at
  runtime. Preserve all user-visible behavior. Fix only the bug
  reported below."
- "Permitted to rewrite the broken function or section if surgical
  patching is unsafe."
- Slot for the categorized error type as guidance (e.g. for
  `syntax`: "the parser failed; check matching braces, quotes, and
  semicolons before changing any logic").
- Output contract identical to generation/refinement (single complete
  HTML file, no fences, etc.) per SPEC §13.

Context shape passed to Sonnet:

```
System prompt (repair variant)
+ Original prompt: "<games.original_prompt>"
+ Error category: <syntax | runtime | logic>
+ Error message: "<error.message>"
+ Stack trace: <error.stack ?? "(none provided)">
+ Current code:
<full games.current_code>
```

No summarization branch for repair: the broken code is exactly what
needs fixing, so a digest would defeat the purpose. SPEC §16's >2000-
token summarization rule is scoped to refinement explicitly. If the
broken code is genuinely huge, the input cost is acceptable on a free
operation that runs at most twice.

### `usage_log` row shape

Per SPEC §5 and §10:

| field            | value                                  |
|------------------|----------------------------------------|
| `action`         | `'repair'`                             |
| `credits_charged`| `0`                                    |
| `succeeded`      | `0` at insert; `1` on stream `done`    |
| `game_id`        | the repaired game's id                 |
| `user_id`        | session user id                        |
| `created_at`     | now                                    |

No counter mutation. No interaction with `applyResets` or `deduct`
from step 7 — repair bypasses the charge service entirely and writes
the row directly via a small `logRepair(userId, gameId)` helper in
`apps/server/src/services/usage/repair-log.ts` (or inline in the
route, if trivially small).

### Fallback dialog

`apps/web/src/components/builder/RepairFallbackDialog.tsx` — built on
shadcn `Dialog`. Opens when `RepairController.status === 'fallback'`.

- **Header:** "We couldn't fix this game automatically."
- **Truncated message:** first ~200 chars of `lastError.message` in a
  monospace block; ellipsis if truncated.
- **Collapsible code panel:** shadcn `Accordion` (or a `details` /
  `summary` if no Accordion is installed yet) wrapping `brokenCode`
  in a scrollable monospace block. Closed by default.
- **CTAs:**
  - **Try again** — closes the dialog, resets `repairAttempt = 0`,
    fires a fresh `POST /api/games` with the game's
    `original_prompt`. This is a full new generation (charges
    credits, overwrites `current_code`). Implemented as a call into
    the existing `useStreamedGeneration` flow with the original
    prompt pre-loaded.
  - **Refine** — closes the dialog, resets `repairAttempt = 0`,
    focuses the persistent prompt input at the bottom of the chat
    panel (SPEC §12). Optionally pre-fills the input with a
    suggestion like `Fix: <truncated message>`; left as an open
    question. The user submits a normal refinement turn (step 6
    flow).
- **Cancel** (close button only): dismisses the dialog. The iframe
  still contains broken code. The user can manually click Refine
  later; the next iframe error event will re-open the dialog because
  `repairAttempt` stayed at 2.

### Concurrency and cancellation

- The step 4 `acquire(userId)` / `release(userId)` Set covers
  `/repair` exactly the same as generation and refinement (SPEC §14).
- Client `AbortController` is created per repair request inside
  `useStreamedRepair`. Aborting (e.g. user navigates away mid-
  repair) closes the SSE connection, server detects close, releases
  the concurrency slot, leaves `usage_log.succeeded = 0`. No refund
  needed (cost is 0).

## Key decisions

- **Hard crashes only trigger repair.** Direct restatement of SPEC §9.
  Detecting silent failures (black canvas, no rAF tick) requires a
  heartbeat protocol from the iframe and a timeout on the parent —
  both are noisy in practice. Games legitimately pause, wait for
  input, render solid colors, etc. A false-positive repair is worse
  than a missing repair: it replaces a working game with a different
  one.
- **Repairs are free.** SPEC §10. The model produced broken code; the
  user did not ask for it to break. Charging would punish users for
  our model's failures and erode trust (SPEC §17 — credit-model
  honesty is on the make-or-break list).
- **Log repairs anyway.** SPEC §5 schema includes `action='repair'`
  with `credits_charged=0`. Why log a free action: observability.
  We need to know how often repairs fire (a high rate signals a
  weak system prompt or RAG library — SPEC §17 #1) and how often
  they succeed (low success rate signals the repair prompt itself
  needs work). Both are visible in `usage_log` queries grouped by
  `action='repair'` and `succeeded`.
- **2-attempt cap.** SPEC §9. After two failed repairs, the model is
  not converging on this code. Continuing wastes tokens and time
  (each attempt is 5–30s of streaming) and frustrates the user
  watching the "fixing..." overlay flicker. The fallback's **Try
  again** path (fresh generation) bypasses the bad code path
  entirely.
- **Client-side counter, not server-side.** Three reasons. (1) The
  counter is per-error-chain in a single browser session; persisting
  it server-side would require either a new column on `games` (state
  pollution) or a session-scoped counter (extra plumbing for no
  benefit). (2) The server already has no notion of "this repair
  request belongs to attempt N" — every `/repair` POST is a fresh,
  stateless invocation from the server's perspective, which keeps
  the endpoint simple and concurrency reasoning local. (3) The
  fallback dialog is a UI concept; routing the cap decision through
  the UI layer keeps the boundary clean.
- **Client-side wrapper injection per step 4.** The wrapper that
  produces the `postMessage` events lives in
  `apps/web/src/lib/iframe-wrapper.ts` (step 4) and is injected
  before every `srcdoc` assignment. Step 11 does not move it
  server-side. SPEC §12 mandates: "Server stores only the LLM's raw
  output as `current_code`; the wrapper is never persisted." Step 11
  preserves that invariant — the repaired HTML returned by Sonnet is
  also unwrapped at rest; the wrapper is re-injected at render time
  by the existing iframe rendering code path.
- **No `messages` row for repair.** SPEC §5 is explicit. The chat
  panel does not show repair attempts; the status overlay does. This
  keeps the chat history free of system noise.
- **Repair stream uses the same SSE schema as generation/refinement.**
  `meta` / `chunk` / `done` / `error` (SPEC §11). One streaming hook
  shape on the client, one writeSSE helper on the server. The `meta`
  payload is functionally redundant for repair (the URL doesn't
  change, the title doesn't change), but uniformity is worth more
  than a few bytes per request.
- **Categorize first, then repair.** SPEC §7 specifies this order
  explicitly. The category is small guidance for the repair prompt;
  it's not a routing decision. We never skip Sonnet based on
  category.
- **Default category on classifier failure.** Mirrors the SPEC §6
  pattern for genre classification: malformed JSON or API failure
  defaults to a sane value (`runtime` here), logs WARN, continues
  the pipeline. Repair must not block on classifier failure.
- **No retry of the categorize call.** A single-shot, soft-fail
  pattern. Retrying GPT-4.1-mini doubles latency for marginal
  benefit; the default fallback is fine.
- **`current_code` is updated only on stream `done`, never mid-
  stream.** Same invariant as generation (step 4) and refinement
  (step 6). Mid-stream code is incomplete HTML and would crash the
  iframe worse than the original error.
- **Try again means full regeneration, not retry of the same code
  path.** SPEC §9: "Try again — re-runs original prompt." This is a
  fresh `POST /api/games` against `games.original_prompt`. It is
  *not* a third repair attempt and it *is* charged credits — the
  user opted in to a fresh generation knowing the auto-repair
  failed.

## Open questions

- **Refine pre-fill text.** Should the **Refine** CTA pre-fill the
  prompt input with `Fix: <truncated message>` or leave it empty and
  just focus the cursor? Default position: focus only, no pre-fill.
  Pre-filled text framed as a "fix" can leak the model's stack
  trace into a refinement prompt, which is rarely productive
  language for Sonnet. Resolve in plan.
- **Counter reset semantics.** The design above resets
  `repairAttempt` on a new user-driven turn (generation /
  refinement / Try again / Refine). Should it also reset on
  `done` from a successful repair? Decision above is no — a second
  crash immediately after a "successful" repair indicates the
  repair didn't really work, and the cap should hold. Confirm
  during execute.
- **Should the fallback dialog also offer "Discard"?** I.e. a
  third button that just deletes the game and returns to the
  dashboard. SPEC §9 lists only Try again / Refine. Default
  position: do not add a third button; the user can hit the
  Dashboard link and use the existing kebab-menu Delete from
  step 5. Confirm during execute.
- **Repair-stream cancellation UX.** Resolved: Stop is HIDDEN
  during repair. Repair is short and free; one less decision for
  the user. The status overlay is read-only during repair. SPEC §12
  describes Stop in the context of generation (long, user-
  initiated, charged); repair does not match that profile.
- **Wrapper-script error coverage gaps.** `try`/`catch` *inside*
  generated `gameLoop` (per SPEC §13 "Wrap game loop in try/catch
  and `postMessage` errors to parent") may swallow errors before
  the `window.error` listener sees them. Confirm during
  verification that errors raised inside the loop's catch
  *re-postMessage* the same shape `{type: 'game-error', ...}`
  that the wrapper expects. If not, this is a SPEC-§13 prompt
  contract issue, not a step 11 issue.

## Acceptance criteria

1. Throwing an uncaught exception inside a generated game's
   `gameLoop` causes the parent builder to receive a `message`
   event with `data.type === 'game-error'` and a non-empty
   `message` field.
2. The same is true for an unhandled promise rejection (e.g.
   `Promise.reject('boom')` not caught).
3. Receipt of `game-error` while `repairAttempt === 0` shows the
   "Detected an error, fixing..." overlay and triggers
   `POST /api/games/:id/repair` with `{ error: { message, stack } }`.
4. `POST /api/games/:id/repair` returns SSE with the same
   `meta`/`chunk`/`done` schema as generation. On `done`, the
   iframe re-renders with the repaired HTML and the overlay
   clears.
5. After `done`, `games.current_code` reflects the repaired HTML
   and a thumbnail recapture has fired (uses the step 5 path).
6. A `usage_log` row exists with `action='repair'`,
   `credits_charged=0`, `succeeded=1`, `game_id` set.
7. On `POST /api/games/:id/repair` stream-error (e.g. invalid
   `ANTHROPIC_API_KEY`), the row is left with `succeeded=0`,
   `current_code` unchanged, no SSE `done`, an SSE `error` event
   delivered.
8. With `repairAttempt === 1` and another `game-error`, a second
   repair fires (`repairAttempt → 2`).
9. With `repairAttempt === 2` and another `game-error`, **no** new
   `/repair` request fires. Instead the fallback dialog opens with
   truncated message and collapsible broken-code panel.
10. **Try again** button in the fallback dialog closes the dialog,
    resets `repairAttempt → 0`, and starts a fresh generation
    using `games.original_prompt`. Credits are charged for this
    generation per the existing step 4/7 flow.
11. **Refine** button in the fallback dialog closes the dialog,
    resets `repairAttempt → 0`, and focuses the persistent prompt
    input. Submitting feedback flows through the existing
    refinement endpoint (step 6).
12. The 1-concurrent-stream cap (SPEC §14) covers `/repair`: a
    repair starting while another stream is in flight returns 409.
13. Client navigation away during a repair aborts the SSE
    connection; the server-side concurrency slot is released; the
    `usage_log` row stays at `succeeded=0`.
14. Categorizer failure (e.g. invalid `OPENAI_API_KEY`) does not
    block repair: a WARN log is emitted and the repair proceeds
    with `category='runtime'` as the default.
15. No `messages` row is written for any repair attempt (SPEC §5).
16. The Stop button is NOT visible during repair streams. The
    status overlay is read-only.

(End of file)
