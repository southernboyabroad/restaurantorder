// Mock config before importing the parser
jest.mock('../config', () => ({
  config: {
    products: ['chicken', 'ribs', 'pulled_pork', 'brisket', 'coleslaw', 'beans'],
    openai: { apiKey: '' },
  },
}));

import { parseOrderStrict } from '../services/orderParser';

describe('parseOrderStrict', () => {
  it('parses "product qty" format', () => {
    const result = parseOrderStrict('chicken 10, ribs 5');
    expect(result).not.toBeNull();
    expect(result!.quantities.chicken).toBe(10);
    expect(result!.quantities.ribs).toBe(5);
    expect(result!.confident).toBe(true);
  });

  it('parses "qty product" format', () => {
    const result = parseOrderStrict('10 chicken, 5 ribs');
    expect(result).not.toBeNull();
    expect(result!.quantities.chicken).toBe(10);
    expect(result!.quantities.ribs).toBe(5);
  });

  it('parses colon-separated format', () => {
    const result = parseOrderStrict('chicken: 10, ribs: 5, coleslaw: 20');
    expect(result).not.toBeNull();
    expect(result!.quantities.chicken).toBe(10);
    expect(result!.quantities.ribs).toBe(5);
    expect(result!.quantities.coleslaw).toBe(20);
  });

  it('handles products with underscores (pulled_pork → pulled pork)', () => {
    const result = parseOrderStrict('pulled pork 15');
    expect(result).not.toBeNull();
    expect(result!.quantities.pulled_pork).toBe(15);
  });

  it('is case insensitive', () => {
    const result = parseOrderStrict('CHICKEN 10, Ribs 5');
    expect(result).not.toBeNull();
    expect(result!.quantities.chicken).toBe(10);
    expect(result!.quantities.ribs).toBe(5);
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
    const result = parseOrderStrict('beans 50');
    expect(result).not.toBeNull();
    expect(result!.quantities.beans).toBe(50);
  });

  it('handles equals sign separator', () => {
    const result = parseOrderStrict('chicken=12');
    expect(result).not.toBeNull();
    expect(result!.quantities.chicken).toBe(12);
  });

  it('handles all products in one message', () => {
    const result = parseOrderStrict(
      'chicken 10, ribs 5, pulled pork 8, brisket 3, coleslaw 20, beans 15',
    );
    expect(result).not.toBeNull();
    expect(result!.quantities.chicken).toBe(10);
    expect(result!.quantities.ribs).toBe(5);
    expect(result!.quantities.pulled_pork).toBe(8);
    expect(result!.quantities.brisket).toBe(3);
    expect(result!.quantities.coleslaw).toBe(20);
    expect(result!.quantities.beans).toBe(15);
  });
});
