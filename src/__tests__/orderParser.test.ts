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
});
