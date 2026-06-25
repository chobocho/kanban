// Generic undo/redo history. Pure and free of any DOM/storage concerns so it
// can be unit tested in isolation (see test/history.test.ts).
//
// The caller owns the "current" state; this class only keeps the past states
// (for undo) and the undone states (for redo). The number of undo steps is
// capped by `maxDepth` so memory stays bounded.

export class History<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  constructor(private readonly maxDepth: number) {
    if (maxDepth < 1) throw new Error('maxDepth must be >= 1');
  }

  /**
   * Record the state that existed *before* a change as a new undo step. Any
   * redo history is discarded because a fresh change forks the timeline.
   */
  record(previous: T): void {
    this.past.push(previous);
    if (this.past.length > this.maxDepth) this.past.shift();
    this.future.length = 0;
  }

  /**
   * Step back one state. `current` is the live state being left behind (kept so
   * a later redo can return to it). Returns the previous state, or null when
   * there is nothing to undo.
   */
  undo(current: T): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    if (this.future.length > this.maxDepth) this.future.shift();
    return previous;
  }

  /**
   * Step forward one state. `current` is the live state being left behind.
   * Returns the next state, or null when there is nothing to redo.
   */
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    if (this.past.length > this.maxDepth) this.past.shift();
    return next;
  }

  /** Forget all recorded history (e.g. when switching to another board). */
  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }
}
