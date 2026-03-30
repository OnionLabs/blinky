import { describe, expect, it } from 'vitest';
import { AsyncMutex } from '../src/connection/AsyncMutex';

describe('AsyncMutex', () => {
  it('starts unlocked', () => {
    const mutex = new AsyncMutex();
    expect(mutex.locked).toBe(false);
  });

  it('locks on acquire and unlocks on release', async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();
    expect(mutex.locked).toBe(true);
    release();
    expect(mutex.locked).toBe(false);
  });

  it('double release is a no-op', async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();
    release();
    release(); // should not throw or corrupt state
    expect(mutex.locked).toBe(false);
  });

  it('serializes concurrent callers in FIFO order', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    const task = async (id: number) => {
      const release = await mutex.acquire();
      order.push(id);
      // simulate async work
      await new Promise((r) => setTimeout(r, 10));
      release();
    };

    // launch 3 tasks concurrently
    await Promise.all([task(1), task(2), task(3)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('runExclusive returns the result', async () => {
    const mutex = new AsyncMutex();
    const result = await mutex.runExclusive(async () => 42);
    expect(result).toBe(42);
    expect(mutex.locked).toBe(false);
  });

  it('runExclusive releases on error', async () => {
    const mutex = new AsyncMutex();
    await expect(
      mutex.runExclusive(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(mutex.locked).toBe(false);
  });

  it('runExclusive serializes execution', async () => {
    const mutex = new AsyncMutex();
    const order: string[] = [];

    const a = mutex.runExclusive(async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a-end');
    });

    const b = mutex.runExclusive(async () => {
      order.push('b-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('b-end');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});
