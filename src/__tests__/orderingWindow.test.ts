// Mock sms.ts (imported by orderingWindow for buildOrderPromptMessage)
jest.mock('../config', () => ({
  config: {
    products: ['toast', '4-inch', 'long', 'institutional_sandwich', 'dinner_rolls'],
    twilio: { accountSid: 'ACtest', authToken: 'test', phoneNumber: '+15550000000' },
    sendgrid: { apiKey: 'SG.test', fromEmail: 'test@example.com', warehouseEmail: 'w@example.com' },
    openai: { apiKey: '' },
    emailSignOffName: 'Test',
    adminPhoneNumber: '',
  },
}));

jest.mock('../services/sms', () => ({
  buildOrderPromptMessage: jest.fn((route?: string, day?: number) => {
    // Simulate real route schedule: 25252 = Wed/Fri/Sat, 25248 = Wed/Sat (not Fri)
    const dow = day ?? 3;
    const map: Record<string, Record<number, string | null>> = {
      '25252': { 3: 'msg', 5: 'msg', 6: 'msg' },
      '25248': { 3: 'msg', 5: null, 6: 'msg' },
    };
    const routeMessages = route ? map[route] : undefined;
    if (routeMessages !== undefined) {
      const msg = routeMessages[dow];
      return msg !== undefined ? msg : null;
    }
    return 'msg'; // fallback for unknown routes
  }),
}));

import { isInsideOrderingWindow, isEarlyOrderWindow, getNextOrderingDate } from '../services/orderingWindow';

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

describe('isEarlyOrderWindow', () => {
  // Non-ordering days → always true
  it('returns true on Tuesday at any time', () => {
    // Tuesday Feb 17, 2026
    expect(isEarlyOrderWindow(easternDate(2026, 2, 17, 8, 0))).toBe(true);
    expect(isEarlyOrderWindow(easternDate(2026, 2, 17, 14, 0))).toBe(true);
    expect(isEarlyOrderWindow(easternDate(2026, 2, 17, 20, 0))).toBe(true);
  });

  it('returns true on Sunday', () => {
    expect(isEarlyOrderWindow(easternDate(2026, 2, 22, 10, 0))).toBe(true);
  });

  it('returns true on Thursday', () => {
    expect(isEarlyOrderWindow(easternDate(2026, 2, 19, 10, 0))).toBe(true);
  });

  // Ordering day before 9:30 AM → true (early order for today)
  it('returns true on Wednesday at 8:00 AM', () => {
    expect(isEarlyOrderWindow(easternDate(2026, 2, 18, 8, 0))).toBe(true);
  });

  // Ordering day 9:30 AM - 1 PM → false (normal window, not early)
  it('returns false on Wednesday at 10:00 AM (inside normal window)', () => {
    expect(isEarlyOrderWindow(easternDate(2026, 2, 18, 10, 0))).toBe(false);
  });

  // Ordering day 1 PM - 6 PM → false (dead zone)
  it('returns false on Wednesday at 3:00 PM (dead zone)', () => {
    expect(isEarlyOrderWindow(easternDate(2026, 2, 18, 15, 0))).toBe(false);
  });

  it('returns false on Wednesday at 5:59 PM (dead zone)', () => {
    expect(isEarlyOrderWindow(easternDate(2026, 2, 18, 17, 59))).toBe(false);
  });

  // Ordering day after 6 PM → true (early order for next delivery)
  it('returns true on Wednesday at 6:00 PM', () => {
    expect(isEarlyOrderWindow(easternDate(2026, 2, 18, 18, 0))).toBe(true);
  });

  it('returns true on Wednesday at 8:00 PM', () => {
    expect(isEarlyOrderWindow(easternDate(2026, 2, 18, 20, 0))).toBe(true);
  });

  it('returns true on Friday at 7:00 PM', () => {
    expect(isEarlyOrderWindow(easternDate(2026, 2, 20, 19, 0))).toBe(true);
  });
});

describe('getNextOrderingDate', () => {
  // Tuesday → next ordering day is Wednesday for route 25252
  it('returns Wednesday for a route 25252 customer texting on Tuesday', () => {
    // Tuesday Feb 17, 2026 at 3 PM
    const tue = easternDate(2026, 2, 17, 15, 0);
    const result = getNextOrderingDate({ route: '25252' }, tue);
    expect(result.dateStr).toBe('2026-02-18'); // Wednesday
    expect(result.dayOfWeek).toBe(3); // Wednesday
  });

  // Wednesday after 6 PM → next is Friday for route 25252
  it('returns Friday for route 25252 customer texting Wed evening', () => {
    // Wednesday Feb 18, 2026 at 8 PM
    const wed = easternDate(2026, 2, 18, 20, 0);
    const result = getNextOrderingDate({ route: '25252' }, wed);
    expect(result.dateStr).toBe('2026-02-20'); // Friday
    expect(result.dayOfWeek).toBe(5); // Friday
  });

  // Wednesday after 6 PM → next is Saturday for route 25248 (skips Friday)
  it('returns Saturday for route 25248 customer texting Wed evening', () => {
    const wed = easternDate(2026, 2, 18, 20, 0);
    const result = getNextOrderingDate({ route: '25248' }, wed);
    expect(result.dateStr).toBe('2026-02-21'); // Saturday
    expect(result.dayOfWeek).toBe(6); // Saturday
  });

  // Before 9:30 AM on an ordering day → today
  it('returns today for customer texting Wed at 8 AM', () => {
    // Wednesday Feb 18, 2026 at 8 AM
    const wed = easternDate(2026, 2, 18, 8, 0);
    const result = getNextOrderingDate({ route: '25252' }, wed);
    expect(result.dateStr).toBe('2026-02-18'); // today (Wednesday)
    expect(result.dayOfWeek).toBe(3);
  });

  // smsDays override: customer only gets texts on Wed/Sat
  it('respects smsDays override', () => {
    // Thursday Feb 19, 2026 at noon
    const thu = easternDate(2026, 2, 19, 12, 0);
    const result = getNextOrderingDate({ route: '25252', smsDays: [3, 6] }, thu);
    expect(result.dateStr).toBe('2026-02-21'); // Saturday (skips Friday because smsDays)
    expect(result.dayOfWeek).toBe(6);
  });

  // Sunday → next Wednesday for standard customer
  it('returns Wednesday for customer texting on Sunday', () => {
    // Sunday Feb 22, 2026 at 10 AM
    const sun = easternDate(2026, 2, 22, 10, 0);
    const result = getNextOrderingDate({ route: '25252' }, sun);
    expect(result.dateStr).toBe('2026-02-25'); // Wednesday
    expect(result.dayOfWeek).toBe(3);
  });
});
