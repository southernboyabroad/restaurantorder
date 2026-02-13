// Mock config before importing the parser
jest.mock('../config', () => ({
  config: {
    products: ['toast', '4-inch', 'long', 'institutional_sandwich', 'dinner_rolls'],
    openai: { apiKey: '' },
  },
}));

import { parseOrderStrict } from '../services/orderParser';

describe('parseOrderStrict', () => {
  it('parses "product qty" format', () => {
    const result = parseOrderStrict('toast 10, long 5');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities.long).toBe(5);
    expect(result!.confident).toBe(true);
  });

  it('parses "qty product" format', () => {
    const result = parseOrderStrict('10 toast, 5 long');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities.long).toBe(5);
  });

  it('parses colon-separated format', () => {
    const result = parseOrderStrict('toast: 10, 4-inch: 5, long: 20');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities['4-inch']).toBe(5);
    expect(result!.quantities.long).toBe(20);
  });

  it('handles products with underscores (institutional_sandwich → institutional sandwich)', () => {
    const result = parseOrderStrict('institutional sandwich 15');
    expect(result).not.toBeNull();
    expect(result!.quantities.institutional_sandwich).toBe(15);
  });

  it('handles hyphenated product names (4-inch)', () => {
    const result = parseOrderStrict('4-inch 12');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(12);
  });

  it('handles "qty 4-inch" format', () => {
    const result = parseOrderStrict('12 4-inch');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(12);
  });

  it('is case insensitive', () => {
    const result = parseOrderStrict('TOAST 10, Long 5');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities.long).toBe(5);
  });

  it('returns null when no products match', () => {
    const result = parseOrderStrict('hello, how are you?');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseOrderStrict('');
    expect(result).toBeNull();
  });

  it('handles a single product order', () => {
    const result = parseOrderStrict('dinner rolls 50');
    expect(result).not.toBeNull();
    expect(result!.quantities.dinner_rolls).toBe(50);
  });

  it('handles equals sign separator', () => {
    const result = parseOrderStrict('toast=12');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(12);
  });

  it('handles all products in one message', () => {
    const result = parseOrderStrict(
      'toast 10, 4-inch 5, long 8, institutional sandwich 3, dinner rolls 20',
    );
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities['4-inch']).toBe(5);
    expect(result!.quantities.long).toBe(8);
    expect(result!.quantities.institutional_sandwich).toBe(3);
    expect(result!.quantities.dinner_rolls).toBe(20);
  });

  it('handles natural-sounding text like "I need 10 toast and 5 long"', () => {
    const result = parseOrderStrict('I need 10 toast and 5 long');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities.long).toBe(5);
  });

  // ── Alias / synonym tests ──────────────────────────────────────
  it('maps "bun" to 4-inch', () => {
    const result = parseOrderStrict('bun 12');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(12);
  });

  it('maps "four-inch bun" to 4-inch', () => {
    const result = parseOrderStrict('four-inch bun 8');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(8);
  });

  it('maps "four-inch hamburger bun" to 4-inch', () => {
    const result = parseOrderStrict('four-inch hamburger bun 6');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(6);
  });

  it('maps "four-inch" to 4-inch', () => {
    const result = parseOrderStrict('four-inch 10');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(10);
  });

  it('maps "hot dog" to long', () => {
    const result = parseOrderStrict('hot dog 15');
    expect(result).not.toBeNull();
    expect(result!.quantities.long).toBe(15);
  });

  it('maps "sandwich" to institutional_sandwich', () => {
    const result = parseOrderStrict('sandwich 20');
    expect(result).not.toBeNull();
    expect(result!.quantities.institutional_sandwich).toBe(20);
  });

  it('maps "three-inch bun" to institutional_sandwich', () => {
    const result = parseOrderStrict('three-inch bun 7');
    expect(result).not.toBeNull();
    expect(result!.quantities.institutional_sandwich).toBe(7);
  });

  it('handles mixed aliases and canonical names', () => {
    const result = parseOrderStrict('toast 10, bun 5, hot dog 8, sandwich 3');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities['4-inch']).toBe(5);
    expect(result!.quantities.long).toBe(8);
    expect(result!.quantities.institutional_sandwich).toBe(3);
  });

  // ── Bare-number / default product tests ─────────────────────────
  it('maps a bare number to the default product', () => {
    const result = parseOrderStrict('12', '4-inch');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(12);
    expect(result!.confident).toBe(true);
  });

  it('maps a bare number in conversational text to the default product', () => {
    const result = parseOrderStrict("I'll take 12", '4-inch');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(12);
  });

  it('does NOT use default product when a product name is explicitly given', () => {
    const result = parseOrderStrict('toast 10', '4-inch');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities['4-inch']).toBeUndefined();
  });

  it('returns null for bare number when no default product is set', () => {
    const result = parseOrderStrict('12');
    expect(result).toBeNull();
  });

  it('returns null for non-numeric text even with a default product', () => {
    const result = parseOrderStrict('hello', '4-inch');
    expect(result).toBeNull();
  });
});
