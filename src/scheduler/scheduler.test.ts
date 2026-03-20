import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWithinTimeWindow } from '../utils/time.js';

// These tests exercise the scheduler's contact-filtering logic in isolation.
// We test isWithinTimeWindow (the core gate) plus the MAX_MESSAGES_PER_RUN cap
// by simulating the filter + slice pattern used in scheduler.ts.

afterEach(() => vi.useRealTimers());

function mockNow(isoString: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoString));
}

// Simulate the scheduler filter: keep contacts where isWithinTimeWindow returns true
function filterEligible(contacts: Array<{ timezone: string; start: string; end: string }>) {
  return contacts.filter(c => isWithinTimeWindow(c.timezone, c.start, c.end));
}

describe('scheduler contact time-window filtering', () => {
  it('includes contacts whose local time is within their window', () => {
    mockNow('2026-01-01T04:30:00Z'); // 10:00 IST
    const contacts = [
      { timezone: 'Asia/Kolkata', start: '08:00', end: '21:00' },  // in window
    ];
    expect(filterEligible(contacts)).toHaveLength(1);
  });

  it('excludes contacts whose local time is outside their window', () => {
    mockNow('2026-01-01T20:30:00Z'); // 02:00 IST next day
    const contacts = [
      { timezone: 'Asia/Kolkata', start: '08:00', end: '21:00' },  // out of window
    ];
    expect(filterEligible(contacts)).toHaveLength(0);
  });

  it('handles multiple contacts in different timezones correctly', () => {
    // 10:00 UTC — IST is 15:30 (in window), EST is 05:00 (out of window 08:00–21:00)
    mockNow('2026-01-01T10:00:00Z');
    const contacts = [
      { timezone: 'Asia/Kolkata',  start: '08:00', end: '21:00' }, // in
      { timezone: 'America/New_York', start: '08:00', end: '21:00' }, // out (05:00 EST)
    ];
    const eligible = filterEligible(contacts);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].timezone).toBe('Asia/Kolkata');
  });

  it('excludes all contacts when none are in-window', () => {
    // 14:00 UTC → IST = 19:30 (after 18:00), PST = 06:00 (before 08:00) — both out
    mockNow('2026-01-01T14:00:00Z');
    const contacts = [
      { timezone: 'Asia/Kolkata',      start: '08:00', end: '18:00' }, // 07:00 IST — out
      { timezone: 'America/Los_Angeles', start: '08:00', end: '18:00' }, // 17:30 PST — out
    ];
    expect(filterEligible(contacts)).toHaveLength(0);
  });
});

describe('scheduler MAX_MESSAGES_PER_RUN cap', () => {
  it('caps the number of contacts processed per tick', () => {
    const MAX = 2;
    const eligible = [
      { name: 'A', timezone: 'UTC', start: '00:00', end: '23:59' },
      { name: 'B', timezone: 'UTC', start: '00:00', end: '23:59' },
      { name: 'C', timezone: 'UTC', start: '00:00', end: '23:59' },
    ];
    const toProcess = eligible.slice(0, MAX);
    expect(toProcess).toHaveLength(MAX);
    expect(toProcess[0].name).toBe('A');
    expect(toProcess[1].name).toBe('B');
  });

  it('processes all contacts when count is under the cap', () => {
    const MAX = 20;
    const eligible = [
      { name: 'A' }, { name: 'B' },
    ];
    expect(eligible.slice(0, MAX)).toHaveLength(2);
  });
});
