/**
 * Check whether the current time in a given timezone falls within a time window.
 *
 * @param timezone  IANA timezone identifier (e.g. 'Asia/Kolkata')
 * @param startTime Start of window in HH:MM format (e.g. '09:00')
 * @param endTime   End of window in HH:MM format (e.g. '21:00')
 * @returns true if the current local time is within [startTime, endTime]
 */
export function isWithinTimeWindow(
  timezone: string,
  startTime: string,
  endTime: string
): boolean {
  const now = new Date();

  // Get the current hours and minutes in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const currentHour = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const currentMinute = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
  const currentMinutes = currentHour * 60 + currentMinute;

  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Handle windows that do not cross midnight
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  // Handle windows that cross midnight (e.g. 22:00 - 06:00)
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

/**
 * Return the current local time string (HH:MM) in a given IANA timezone.
 * Used for logging so we can show the contact's local time alongside the decision.
 */
export function getCurrentTimeInZone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return '??:??';
  }
}

/**
 * Return a promise that resolves after a random delay between minMs and maxMs.
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}
