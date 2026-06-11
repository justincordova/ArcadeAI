import { describe, expect, test } from "vitest";
import { decideIntentAction } from "./play-intent.js";

describe("decideIntentAction — preconditions", () => {
  test("waits when there is no intent", () => {
    expect(
      decideIntentAction({
        intent: undefined,
        hasSession: true,
        gameLoaded: true,
        gameLiked: false,
      })
    ).toBe("wait");
  });

  test("waits when there is no session (signed-out visitor)", () => {
    expect(
      decideIntentAction({ intent: "remix", hasSession: false, gameLoaded: true, gameLiked: false })
    ).toBe("wait");
  });

  test("waits on an unknown intent value", () => {
    expect(
      decideIntentAction({ intent: "bogus", hasSession: true, gameLoaded: true, gameLiked: false })
    ).toBe("wait");
  });
});

describe("decideIntentAction — remix", () => {
  test("fires remix as soon as session exists (does not wait for game load)", () => {
    expect(
      decideIntentAction({ intent: "remix", hasSession: true, gameLoaded: false, gameLiked: false })
    ).toBe("remix");
  });
});

describe("decideIntentAction — like", () => {
  test("waits until the game has loaded", () => {
    expect(
      decideIntentAction({ intent: "like", hasSession: true, gameLoaded: false, gameLiked: false })
    ).toBe("wait");
  });

  test("fires like when game loaded and not yet liked", () => {
    expect(
      decideIntentAction({ intent: "like", hasSession: true, gameLoaded: true, gameLiked: false })
    ).toBe("like");
  });

  test("latches without firing when the game is already liked", () => {
    // Returning from OAuth on a game liked from another device: must clear
    // the lingering ?intent=like param but not re-like.
    expect(
      decideIntentAction({ intent: "like", hasSession: true, gameLoaded: true, gameLiked: true })
    ).toBe("latch-only");
  });
});
