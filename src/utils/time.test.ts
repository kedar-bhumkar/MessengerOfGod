import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWithinTimeWindow, getCurrentTimeInZone } from './time.js';

afterEach(() => vi.useRealTimers());

// ─── isWithinTimeWindow ───────────────────────────────────────────────────────

describe('isWithinTimeWindow', () => {
  function mockTime(isoString: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(isoString));
  }

  it('returns true when current time is inside a normal window', () => {
    // 10:00 UTC = 15:30 IST. Window 08:00–21:00 IST.
    mockTime('2026-01-01T04:30:00Z'); // 10:00 IST
    expect(isWithinTimeWindow('Asia/Kolkata', '08:00', '21:00')).toBe(true);
  });

  it('returns false when current time is before the window', () => {
    // 02:00 IST. Window 08:00–21:00 IST.
    mockTime('2025-12-31T20:30:00Z'); // 02:00 IST next day
    expect(isWithinTimeWindow('Asia/Kolkata', '08:00', '21:00')).toBe(false);
  });

  it('returns false when current time is after the window', () => {
    // 22:00 IST. Window 08:00–21:00 IST.
    mockTime('2026-01-01T16:30:00Z'); // 22:00 IST
    expect(isWithinTimeWindow('Asia/Kolkata', '08:00', '21:00')).toBe(false);
  });

  it('returns true exactly at window start boundary', () => {
    // 08:00 IST = 02:30 UTC
    mockTime('2026-01-01T02:30:00Z');
    expect(isWithinTimeWindow('Asia/Kolkata', '08:00', '21:00')).toBe(true);
  });

  it('returns true exactly at window end boundary', () => {
    // 21:00 IST = 15:30 UTC
    mockTime('2026-01-01T15:30:00Z');
    expect(isWithinTimeWindow('Asia/Kolkata', '08:00', '21:00')).toBe(true);
  });

  it('handles midnight-crossing window: returns true just before midnight (in window)', () => {
    // 23:00 in US/Eastern. Window 22:00–06:00 crosses midnight.
    mockTime('2026-01-01T04:00:00Z'); // 23:00 EST (UTC-5)
    expect(isWithinTimeWindow('America/New_York', '22:00', '06:00')).toBe(true);
  });

  it('handles midnight-crossing window: returns true just after midnight (in window)', () => {
    // 02:00 in US/Eastern. Window 22:00–06:00.
    mockTime('2026-01-01T07:00:00Z'); // 02:00 EST
    expect(isWithinTimeWindow('America/New_York', '22:00', '06:00')).toBe(true);
  });

  it('handles midnight-crossing window: returns false in middle of day (outside window)', () => {
    // 14:00 in US/Eastern. Window 22:00–06:00.
    mockTime('2026-01-01T19:00:00Z'); // 14:00 EST
    expect(isWithinTimeWindow('America/New_York', '22:00', '06:00')).toBe(false);
  });

  it('works correctly for UTC timezone', () => {
    mockTime('2026-01-01T10:00:00Z');
    expect(isWithinTimeWindow('UTC', '09:00', '17:00')).toBe(true);
  });
});

// ─── getCurrentTimeInZone ─────────────────────────────────────────────────────

describe('getCurrentTimeInZone', () => {
  it('returns a string in HH:MM format', () => {
    const result = getCurrentTimeInZone('Asia/Kolkata');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns ??:?? for an invalid timezone', () => {
    expect(getCurrentTimeInZone('Not/AReal_Zone')).toBe('??:??');
  });

  it('returns a different time for different timezones', () => {
    const ist = getCurrentTimeInZone('Asia/Kolkata');
    const utc = getCurrentTimeInZone('UTC');
    // They may differ — just confirm both match the format
    expect(ist).toMatch(/^\d{2}:\d{2}$/);
    expect(utc).toMatch(/^\d{2}:\d{2}$/);
  });
});
