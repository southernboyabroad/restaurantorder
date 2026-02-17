// ── Ordering window check ────────────────────────────────────────
// The bot only processes orders on Wed (3), Fri (5), Sat (6)
// between 9:30 AM and 1:00 PM Eastern.
// Outside that window, texts pass through silently (no bot reply)
// so you and your customers can text normally on the Twilio number.

const ORDERING_DAYS = new Set([3, 5, 6]); // Wed, Fri, Sat
const WINDOW_OPEN_MINUTES = 9 * 60 + 30;  // 9:30 AM
const WINDOW_CLOSE_MINUTES = 13 * 60;     // 1:00 PM

export function isInsideOrderingWindow(now?: Date): boolean {
  const d = now || new Date();
  // Build a date string in Eastern time to determine the local day/hour/minute
  const parts = d
    .toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
    .split(/[/, :]+/)
    .map((s) => s.trim());
  // parts: [month, day, year, hour, minute, second]
  const hour = parseInt(parts[3], 10);
  const minute = parseInt(parts[4], 10);
  // Derive the day-of-week from the Eastern-localized date
  const easternDate = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = easternDate.getDay();

  if (!ORDERING_DAYS.has(dayOfWeek)) return false;

  const currentMinutes = hour * 60 + minute;
  return currentMinutes >= WINDOW_OPEN_MINUTES && currentMinutes < WINDOW_CLOSE_MINUTES;
}
