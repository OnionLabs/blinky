/**
 * Promise-based async mutex for serializing access to the serial port.
 * Only one caller can hold the lock at a time; others queue up.
 *
 * Notes / limitations:
 * - Not reentrant: a holder calling `acquire()/runExclusive()` again
 *   from within its own critical section will deadlock.
 * - Queue is unbounded. The expected workload (REPL ops) is low-volume,
 *   so this is acceptable; callers should not enqueue work in tight loops
 *   without an upstream gate.
 */
export class AsyncMutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  get locked(): boolean {
    return this._locked;
  }

  async acquire(): Promise<() => void> {
    if (!this._locked) {
      this._locked = true;
      return this._createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this._queue.push(() => resolve(this._createRelease()));
    });
  }

  private _createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = this._queue.shift();
      if (next) {
        next();
      } else {
        this._locked = false;
      }
    };
  }

  /**
   * Execute a function while holding the lock.
   * The lock is released when the function completes (or throws).
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
