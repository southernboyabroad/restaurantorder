jest.mock('../config', () => ({
  config: {
    products: ['toast', '4-inch', 'long', 'institutional_sandwich', 'dinner_rolls'],
    emailSignOffName: 'Bryant',
  },
}));

jest.mock('../services/sheets', () => ({
  getTodaysOrders: jest.fn(),
}));

import { generateSummary, generateSummariesByRoute, formatSummaryText, getDeliveryDate, deliveryDayName } from '../services/orderSummary';
import { getTodaysOrders } from '../services/sheets';

const mockGetTodaysOrders = getTodaysOrders as jest.MockedFunction<typeof getTodaysOrders>;

describe('generateSummary', () => {
  it('aggregates quantities across multiple orders', async () => {
    mockGetTodaysOrders.mockResolvedValue([
      {
        date: '2025-01-15',
        phone: '+15551111111',
        name: 'Alice',
        route: '25252',
        quantities: { toast: 10, '4-inch': 5, long: 0, institutional_sandwich: 0, dinner_rolls: 0 },
        rawReply: 'toast 10, 4-inch 5',
      },
      {
        date: '2025-01-15',
        phone: '+15552222222',
        name: 'Bob',
        route: '25248',
        quantities: { toast: 5, '4-inch': 0, long: 8, institutional_sandwich: 0, dinner_rolls: 20 },
        rawReply: 'toast 5, long 8, dinner rolls 20',
      },
    ]);

    const summary = await generateSummary('2025-01-15');

    expect(summary.orderCount).toBe(2);
    expect(summary.totalsByProduct.toast).toBe(15);
    expect(summary.totalsByProduct['4-inch']).toBe(5);
    expect(summary.totalsByProduct.long).toBe(8);
    expect(summary.totalsByProduct.dinner_rolls).toBe(20);
    expect(summary.totalsByProduct.institutional_sandwich).toBe(0);
  });

  it('returns zero totals when no orders exist', async () => {
    mockGetTodaysOrders.mockResolvedValue([]);

    const summary = await generateSummary('2025-01-15');

    expect(summary.orderCount).toBe(0);
    expect(summary.totalsByProduct.toast).toBe(0);
  });
});

describe('generateSummariesByRoute', () => {
  it('groups orders by route and generates separate summaries', async () => {
    mockGetTodaysOrders.mockResolvedValue([
      {
        date: '2025-01-15',
        phone: '+15551111111',
        name: 'Alice',
        route: '25252',
        quantities: { toast: 10, '4-inch': 5, long: 0, institutional_sandwich: 0, dinner_rolls: 0 },
        rawReply: 'toast 10, 4-inch 5',
      },
      {
        date: '2025-01-15',
        phone: '+15552222222',
        name: 'Bob',
        route: '25248',
        quantities: { toast: 5, '4-inch': 0, long: 8, institutional_sandwich: 0, dinner_rolls: 20 },
        rawReply: 'toast 5, long 8, dinner rolls 20',
      },
      {
        date: '2025-01-15',
        phone: '+15553333333',
        name: 'Charlie',
        route: '25252',
        quantities: { toast: 3, '4-inch': 0, long: 0, institutional_sandwich: 0, dinner_rolls: 0 },
        rawReply: 'toast 3',
      },
    ]);

    const summaries = await generateSummariesByRoute('2025-01-15');

    expect(summaries).toHaveLength(2);

    const route25252 = summaries.find((s) => s.route === '25252')!;
    expect(route25252).toBeDefined();
    expect(route25252.orderCount).toBe(2);
    expect(route25252.totalsByProduct.toast).toBe(13);
    expect(route25252.totalsByProduct['4-inch']).toBe(5);

    const route25248 = summaries.find((s) => s.route === '25248')!;
    expect(route25248).toBeDefined();
    expect(route25248.orderCount).toBe(1);
    expect(route25248.totalsByProduct.toast).toBe(5);
    expect(route25248.totalsByProduct.long).toBe(8);
  });

  it('returns empty array when no orders exist', async () => {
    mockGetTodaysOrders.mockResolvedValue([]);

    const summaries = await generateSummariesByRoute('2025-01-15');

    expect(summaries).toHaveLength(0);
  });
});

describe('formatSummaryText', () => {
  it('produces a readable text summary with delivery day and sign-off', () => {
    const text = formatSummaryText({
      date: '2025-01-15',
      route: '25252',
      orderCount: 1,
      totalsByProduct: { toast: 10, '4-inch': 0, long: 0, institutional_sandwich: 0, dinner_rolls: 0 },
      orders: [
        {
          date: '2025-01-15',
          phone: '+15551111111',
          name: 'Alice',
          route: '25252',
          quantities: { toast: 10 },
          rawReply: 'toast 10',
        },
      ],
    }, 'Monday');

    expect(text).toContain('please add the following to Monday and confirm:');
    expect(text).toContain('ALL INSTITUTIONAL');
    expect(text).toContain('10 - toast');
    expect(text).toContain('Thx,');
    expect(text).toContain('Bryant');
    expect(text).not.toContain('4 inch'); // 0-qty products omitted
  });
});

describe('getDeliveryDate', () => {
  it('returns next day for a Wednesday', () => {
    // Wed Feb 18, 2026
    const wed = new Date(2026, 1, 18);
    const delivery = getDeliveryDate(wed);
    expect(delivery.getDay()).toBe(4); // Thursday
  });

  it('skips Sunday for a Saturday', () => {
    // Sat Feb 14, 2026
    const sat = new Date(2026, 1, 14);
    const delivery = getDeliveryDate(sat);
    expect(delivery.getDay()).toBe(1); // Monday
    expect(deliveryDayName(delivery)).toBe('Monday');
  });

  it('returns Saturday for a Friday', () => {
    // Fri Feb 13, 2026
    const fri = new Date(2026, 1, 13);
    const delivery = getDeliveryDate(fri);
    expect(delivery.getDay()).toBe(6); // Saturday
  });
});
