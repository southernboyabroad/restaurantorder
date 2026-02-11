jest.mock('../config', () => ({
  config: {
    products: ['toast', '4-inch', 'long', 'institutional_sandwich', 'dinner_rolls'],
  },
}));

jest.mock('../services/sheets', () => ({
  getTodaysOrders: jest.fn(),
}));

import { generateSummary, formatSummaryText } from '../services/orderSummary';
import { getTodaysOrders } from '../services/sheets';

const mockGetTodaysOrders = getTodaysOrders as jest.MockedFunction<typeof getTodaysOrders>;

describe('generateSummary', () => {
  it('aggregates quantities across multiple orders', async () => {
    mockGetTodaysOrders.mockResolvedValue([
      {
        date: '2025-01-15',
        phone: '+15551111111',
        name: 'Alice',
        quantities: { toast: 10, '4-inch': 5, long: 0, institutional_sandwich: 0, dinner_rolls: 0 },
        rawReply: 'toast 10, 4-inch 5',
      },
      {
        date: '2025-01-15',
        phone: '+15552222222',
        name: 'Bob',
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

describe('formatSummaryText', () => {
  it('produces a readable text summary', () => {
    const text = formatSummaryText({
      date: '2025-01-15',
      orderCount: 1,
      totalsByProduct: { toast: 10, '4-inch': 0, long: 0, institutional_sandwich: 0, dinner_rolls: 0 },
      orders: [
        {
          date: '2025-01-15',
          phone: '+15551111111',
          name: 'Alice',
          quantities: { toast: 10 },
          rawReply: 'toast 10',
        },
      ],
    });

    expect(text).toContain('ORDER SUMMARY');
    expect(text).toContain('2025-01-15');
    expect(text).toContain('TOAST: 10');
    expect(text).toContain('Alice');
  });
});
