jest.mock('../config', () => ({
  config: {
    products: ['chicken', 'ribs', 'pulled_pork', 'brisket', 'coleslaw', 'beans'],
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
        quantities: { chicken: 10, ribs: 5, pulled_pork: 0, brisket: 0, coleslaw: 0, beans: 0 },
        rawReply: 'chicken 10, ribs 5',
      },
      {
        date: '2025-01-15',
        phone: '+15552222222',
        name: 'Bob',
        quantities: { chicken: 5, ribs: 0, pulled_pork: 8, brisket: 0, coleslaw: 20, beans: 0 },
        rawReply: 'chicken 5, pulled pork 8, coleslaw 20',
      },
    ]);

    const summary = await generateSummary('2025-01-15');

    expect(summary.orderCount).toBe(2);
    expect(summary.totalsByProduct.chicken).toBe(15);
    expect(summary.totalsByProduct.ribs).toBe(5);
    expect(summary.totalsByProduct.pulled_pork).toBe(8);
    expect(summary.totalsByProduct.coleslaw).toBe(20);
    expect(summary.totalsByProduct.brisket).toBe(0);
    expect(summary.totalsByProduct.beans).toBe(0);
  });

  it('returns zero totals when no orders exist', async () => {
    mockGetTodaysOrders.mockResolvedValue([]);

    const summary = await generateSummary('2025-01-15');

    expect(summary.orderCount).toBe(0);
    expect(summary.totalsByProduct.chicken).toBe(0);
  });
});

describe('formatSummaryText', () => {
  it('produces a readable text summary', () => {
    const text = formatSummaryText({
      date: '2025-01-15',
      orderCount: 1,
      totalsByProduct: { chicken: 10, ribs: 0, pulled_pork: 0, brisket: 0, coleslaw: 0, beans: 0 },
      orders: [
        {
          date: '2025-01-15',
          phone: '+15551111111',
          name: 'Alice',
          quantities: { chicken: 10 },
          rawReply: 'chicken 10',
        },
      ],
    });

    expect(text).toContain('ORDER SUMMARY');
    expect(text).toContain('2025-01-15');
    expect(text).toContain('CHICKEN: 10');
    expect(text).toContain('Alice');
  });
});
