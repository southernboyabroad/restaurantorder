import { isInsideOrderingWindow } from '../services/orderingWindow';

// Helper: build a Date for a specific Eastern time.
// We construct a UTC date that, when converted to Eastern, lands on the desired day/time.
// Eastern is UTC-5 (EST) or UTC-4 (EDT).
function easternDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  // Create the date string as if it were Eastern, then let JS parse it
  // Using explicit timezone via toLocaleString round-trip
  const str = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  // Parse as Eastern by constructing the date in UTC and adjusting
  // A simpler approach: create a date in the target timezone
  const utcDate = new Date(str + 'Z');
  // Check if DST is in effect for this date (March-November roughly)
  const isDST = month >= 3 && month <= 10; // rough approximation
  const offset = isDST ? 4 : 5; // EDT = UTC-4, EST = UTC-5
  return new Date(utcDate.getTime() + offset * 60 * 60 * 1000);
}

describe('isInsideOrderingWindow', () => {
  // Wednesday Feb 18, 2026 (day 3)
  it('returns true on Wednesday at 9:30 AM Eastern', () => {
    const wed930 = easternDate(2026, 2, 18, 9, 30);
    expect(isInsideOrderingWindow(wed930)).toBe(true);
  });

  it('returns true on Wednesday at 10:00 AM Eastern', () => {
    const wed1000 = easternDate(2026, 2, 18, 10, 0);
    expect(isInsideOrderingWindow(wed1000)).toBe(true);
  });

  it('returns true on Wednesday at 12:59 PM Eastern', () => {
    const wed1259 = easternDate(2026, 2, 18, 12, 59);
    expect(isInsideOrderingWindow(wed1259)).toBe(true);
  });

  it('returns false on Wednesday at 9:29 AM Eastern (before window)', () => {
    const wed929 = easternDate(2026, 2, 18, 9, 29);
    expect(isInsideOrderingWindow(wed929)).toBe(false);
  });

  it('returns false on Wednesday at 1:00 PM Eastern (window closed)', () => {
    const wed1300 = easternDate(2026, 2, 18, 13, 0);
    expect(isInsideOrderingWindow(wed1300)).toBe(false);
  });

  it('returns false on Wednesday at 5:00 PM Eastern', () => {
    const wed1700 = easternDate(2026, 2, 18, 17, 0);
    expect(isInsideOrderingWindow(wed1700)).toBe(false);
  });

  // Friday Feb 20, 2026 (day 5)
  it('returns true on Friday at 11:00 AM Eastern', () => {
    const fri1100 = easternDate(2026, 2, 20, 11, 0);
    expect(isInsideOrderingWindow(fri1100)).toBe(true);
  });

  // Saturday Feb 21, 2026 (day 6)
  it('returns true on Saturday at 10:30 AM Eastern', () => {
    const sat1030 = easternDate(2026, 2, 21, 10, 30);
    expect(isInsideOrderingWindow(sat1030)).toBe(true);
  });

  // Non-ordering days
  it('returns false on Monday at 10:00 AM Eastern', () => {
    // Monday Feb 16, 2026
    const mon1000 = easternDate(2026, 2, 16, 10, 0);
    expect(isInsideOrderingWindow(mon1000)).toBe(false);
  });

  it('returns false on Tuesday at 10:00 AM Eastern', () => {
    // Tuesday Feb 17, 2026
    const tue1000 = easternDate(2026, 2, 17, 10, 0);
    expect(isInsideOrderingWindow(tue1000)).toBe(false);
  });

  it('returns false on Thursday at 10:00 AM Eastern', () => {
    // Thursday Feb 19, 2026
    const thu1000 = easternDate(2026, 2, 19, 10, 0);
    expect(isInsideOrderingWindow(thu1000)).toBe(false);
  });

  it('returns false on Sunday at 10:00 AM Eastern', () => {
    // Sunday Feb 22, 2026
    const sun1000 = easternDate(2026, 2, 22, 10, 0);
    expect(isInsideOrderingWindow(sun1000)).toBe(false);
  });
});
