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
