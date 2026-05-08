// In-memory concurrency lock: at most one active streaming operation per
// user across generation, refinement, and repair. SPEC §14.
//
// This is process-local. A multi-instance deployment would need a Redis-
// backed lock, but for the prototype's single-process model the in-memory
// set is correct and survives no failure modes that warrant disk
// persistence.
const activeStreams = new Set<string>();

export class ConcurrencyError extends Error {
  constructor() {
    super("A generation is already in progress");
    this.name = "ConcurrencyError";
  }
}

export function acquire(userId: string): void {
  if (activeStreams.has(userId)) {
    throw new ConcurrencyError();
  }
  activeStreams.add(userId);
}

export function release(userId: string): void {
  activeStreams.delete(userId);
}

/**
 * Return the current number of active streams. Used by graceful-shutdown to
 * decide whether to wait for in-flight work to finish.
 */
export function activeCount(): number {
  return activeStreams.size;
}

/**
 * Empty the lock set. Called once at startup to clear any stale entries that
 * could exist if a previous process crashed while holding a lock — though in
 * practice the Set is per-process and starts empty, this is defense in depth
 * and a hook point for tests.
 */
export function clear(): void {
  activeStreams.clear();
}
