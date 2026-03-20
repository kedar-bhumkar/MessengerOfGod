import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './retry.js';

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  const opts = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 };

  it('returns the result immediately when operation succeeds on first try', async () => {
    const op = vi.fn().mockResolvedValue('hello');
    const result = await withRetry(op, opts);
    expect(result).toBe('hello');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries and succeeds on a later attempt', async () => {
    let calls = 0;
    const op = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    });

    const result = await withRetry(op, opts);
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('throws the original error after exhausting all attempts', async () => {
    const err = new Error('permanent failure');
    const op = vi.fn().mockRejectedValue(err);

    await expect(withRetry(op, opts)).rejects.toThrow('permanent failure');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('respects maxAttempts=1 (no retries)', async () => {
    const op = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(op, { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 100 }))
      .rejects.toThrow('fail');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('does not exceed maxDelayMs for the backoff calculation', async () => {
    // With baseDelayMs=1000 and maxDelayMs=50, delay should never exceed 50ms.
    // We verify indirectly: if the cap weren't applied the test would take far longer.
    let calls = 0;
    const op = vi.fn().mockImplementation(async () => {
      if (++calls < 3) throw new Error('retry me');
      return 'done';
    });
    const start = Date.now();
    await withRetry(op, { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 50 });
    // Should complete well under 500 ms even with two waits capped at 50 ms each
    expect(Date.now() - start).toBeLessThan(500);
  });
});
