import { logger } from './logger.js';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Execute an async operation with exponential backoff and jitter.
 *
 * On each retry the delay is calculated as:
 *   delay = min(baseDelayMs * 2^attempt + jitter, maxDelayMs)
 *
 * where jitter is a random value between 0 and baseDelayMs.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts - 1;

      if (isLastAttempt) {
        throw error;
      }

      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelayMs;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      logger.warn(
        { attempt: attempt + 1, maxAttempts, delayMs: Math.round(delay), error },
        'Operation failed, retrying...'
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Unreachable, but satisfies TypeScript strict mode
  throw new Error('withRetry: exhausted all attempts');
}
