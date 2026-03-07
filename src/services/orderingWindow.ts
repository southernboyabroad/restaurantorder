// ── Ordering window check ────────────────────────────────────────
// The bot only processes orders on Wed (3), Fri (5), Sat (6)
// between 9:30 AM and 1:00 PM Eastern.
// Outside that window, texts pass through silently (no bot reply)
// so you and your customers can text normally on the Twilio number.
//
// Early orders: customers can text their order any time after 6 PM
// on an ordering day, or any time on a non-ordering day, and the
// order is recorded for the next scheduled ordering date. Those
// customers are then skipped in the morning SMS blast.

import { buildOrderPromptMessage } from './sms';

const ORDERING_DAYS = new Set([3, 5, 6]); // Wed, Fri, Sat
const WINDOW_OPEN_MINUTES = 9 * 60 + 30;  // 9:30 AM
const WINDOW_CLOSE_MINUTES = 13 * 60;     // 1:00 PM
const EARLY_ORDER_CUTOFF_MINUTES = 18 * 60; // 6:00 PM

// ── Helpers for Eastern time ─────────────────────────────────────

function getEasternComponents(d: Date): { dayOfWeek: number; currentMinutes: number } {
  const parts = d
    .toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
    .split(/[/, :]+/)
    .map((s) => s.trim());
  const hour = parseInt(parts[3], 10);
  const minute = parseInt(parts[4], 10);
  const easternDate = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return { dayOfWeek: easternDate.getDay(), currentMinutes: hour * 60 + minute };
}

function easternDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function isInsideOrderingWindow(now?: Date): boolean {
  const d = now || new Date();
  const { dayOfWeek, currentMinutes } = getEasternComponents(d);
  if (!ORDERING_DAYS.has(dayOfWeek)) return false;
  return currentMinutes >= WINDOW_OPEN_MINUTES && currentMinutes < WINDOW_CLOSE_MINUTES;
}

// ── Early order window ───────────────────────────────────────────
// Returns true when a customer text should be treated as an early
// order for the next delivery:
//   • Non-ordering day (Sun, Mon, Tue, Thu) — any time
//   • Ordering day (Wed, Fri, Sat) after 6 PM
//   • Ordering day before 9:30 AM (customer is ordering early for today)
// Returns false during the 1 PM – 6 PM gap on ordering days (dead zone).

export function isEarlyOrderWindow(now?: Date): boolean {
  const d = now || new Date();
  const { dayOfWeek, currentMinutes } = getEasternComponents(d);

  // Non-ordering day → always accept early orders
  if (!ORDERING_DAYS.has(dayOfWeek)) return true;

  // Ordering day before the window opens → early order for today
  if (currentMinutes < WINDOW_OPEN_MINUTES) return true;

  // Ordering day after 6 PM → early order for next delivery
  if (currentMinutes >= EARLY_ORDER_CUTOFF_MINUTES) return true;

  // 1 PM – 6 PM gap → dead zone, stay silent
  return false;
}

// ── Next ordering date for a customer ────────────────────────────
// Determines which date an early order should be recorded against.
// • Before 9:30 AM on an ordering day → today (same-day early order)
// • Otherwise → the next day this customer would be texted

export function getNextOrderingDate(
  customer: { route?: string; smsDays?: number[] },
  now?: Date,
): { dateStr: string; dayOfWeek: number } {
  const d = now || new Date();
  const { dayOfWeek: currentDay, currentMinutes } = getEasternComponents(d);

  // Before 9:30 AM on an ordering day → order is for today
  if (ORDERING_DAYS.has(currentDay) && currentMinutes < WINDOW_OPEN_MINUTES) {
    return { dateStr: easternDateStr(d), dayOfWeek: currentDay };
  }

  // Find the next day this customer would normally be texted
  const todayStr = easternDateStr(d);
  const [year, month, day] = todayStr.split('-').map(Number);

  for (let offset = 1; offset <= 7; offset++) {
    const futureDay = (currentDay + offset) % 7;

    // Must be a valid ordering day
    if (!ORDERING_DAYS.has(futureDay)) continue;

    // Respect per-customer smsDays override
    if (customer.smsDays && !customer.smsDays.includes(futureDay)) continue;

    // Check if the route actually sends a text on this day
    if (!customer.smsDays) {
      const message = buildOrderPromptMessage(customer.route, futureDay);
      if (message === null) continue;
    }

    // Build the date string in Eastern time
    const futureDate = new Date(year, month - 1, day + offset);
    const dateStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
    return { dateStr, dayOfWeek: futureDay };
  }

  // Fallback: next ordering day (no route/smsDays filter)
  for (let offset = 1; offset <= 7; offset++) {
    const futureDay = (currentDay + offset) % 7;
    if (ORDERING_DAYS.has(futureDay)) {
      const futureDate = new Date(year, month - 1, day + offset);
      const dateStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      return { dateStr, dayOfWeek: futureDay };
    }
  }

  // Should never reach here
  return { dateStr: todayStr, dayOfWeek: currentDay };
}
