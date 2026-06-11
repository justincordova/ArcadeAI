/**
 * Pure decision for the post-sign-in intent latch on /play/:slug. Given the
 * current `?intent`, whether a session exists, and (for like) whether the
 * game is loaded and already liked, decide what the route effect should do:
 *
 *   - "wait"  — preconditions not met yet (no intent, no session, or a
 *               like-intent whose game hasn't loaded). Do nothing, don't latch.
 *   - "remix" — latch and fire the remix mutation.
 *   - "like"  — latch and fire the like mutation.
 *   - "latch-only" — latch and clear the param but DON'T fire (e.g. a
 *                    like-intent on a game that's already liked).
 *
 * Lives outside the route file so it stays unit-testable without a
 * router/query harness and doesn't add non-route exports to a code-split
 * route module (routes/play.$slug.tsx).
 */
export type IntentAction = "wait" | "remix" | "like" | "latch-only";

export function decideIntentAction(args: {
  intent: string | undefined;
  hasSession: boolean;
  gameLoaded: boolean;
  gameLiked: boolean;
}): IntentAction {
  const { intent, hasSession, gameLoaded, gameLiked } = args;
  if (!intent || !hasSession) return "wait";
  if (intent === "remix") return "remix";
  if (intent === "like") {
    if (!gameLoaded) return "wait";
    return gameLiked ? "latch-only" : "like";
  }
  return "wait";
}
