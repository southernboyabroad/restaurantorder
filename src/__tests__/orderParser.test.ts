// Mock config before importing the parser
jest.mock('../config', () => ({
  config: {
    products: ['toast', '4-inch', 'long', 'institutional_sandwich', 'dinner_rolls'],
    openai: { apiKey: '' },
  },
}));

import { parseOrderStrict, isAffirmativeReply, isDeclineReply, parseCorrectionRequest, preprocessCorrectionText } from '../services/orderParser';

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

  it('maps "dinner" to dinner_rolls', () => {
    const result = parseOrderStrict('dinner 30');
    expect(result).not.toBeNull();
    expect(result!.quantities.dinner_rolls).toBe(30);
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

  // ── Casual / natural language tests ─────────────────────────────
  it('handles comma between number and product: "6, 4-inch"', () => {
    const result = parseOrderStrict('6, 4-inch');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(6);
  });

  it('handles word numbers like "five toast, six long"', () => {
    const result = parseOrderStrict('five toast, six long');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(5);
    expect(result!.quantities.long).toBe(6);
  });

  it('handles "too" as "two" — "too long" → long: 2', () => {
    const result = parseOrderStrict('too long');
    expect(result).not.toBeNull();
    expect(result!.quantities.long).toBe(2);
  });

  it('handles the real-world message: "Thank you, can I get 5 toast, 6, 4-inch, too long?"', () => {
    const result = parseOrderStrict('Thank you, can I get 5 toast, 6, 4-inch, too long?');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(5);
    expect(result!.quantities['4-inch']).toBe(6);
    expect(result!.quantities.long).toBe(2);
  });

  it('handles compound word numbers like "twenty five toast"', () => {
    const result = parseOrderStrict('twenty five toast');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(25);
  });

  it('handles casual phrasing: "I\'d like ten toast and fifteen long please"', () => {
    const result = parseOrderStrict("I'd like ten toast and fifteen long please");
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities.long).toBe(15);
  });

  it('handles "can I get 12 toast, 5 bun, and 3 long"', () => {
    const result = parseOrderStrict('can I get 12 toast, 5 bun, and 3 long');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(12);
    expect(result!.quantities['4-inch']).toBe(5);
    expect(result!.quantities.long).toBe(3);
  });

  it('handles product then comma then number: "toast, 10"', () => {
    const result = parseOrderStrict('toast, 10');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
  });

  it('handles item-first with dash-quantity: "4-inch -10"', () => {
    const result = parseOrderStrict('4-inch -10');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(10);
  });

  it('handles item-first with dash-quantity for multiple products: "4-inch -10 toast -5"', () => {
    const result = parseOrderStrict('4-inch -10 toast -5');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(10);
    expect(result!.quantities.toast).toBe(5);
  });

  it('handles "4 in - 5" (space-dash-space quantity) → 4-inch: 5', () => {
    const result = parseOrderStrict('4 in - 5');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(5);
  });

  it('handles "4 in -5" (dash-no-space quantity) → 4-inch: 5', () => {
    const result = parseOrderStrict('4 in -5');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(5);
  });

  it('parses 3-item order containing "4 in - 5": "10 toast, 4 in - 5, 6 long"', () => {
    const result = parseOrderStrict('10 toast, 4 in - 5, 6 long');
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities['4-inch']).toBe(5);
    expect(result!.quantities.long).toBe(6);
  });

  // ── Alias accumulation tests ──────────────────────────────────
  it('accumulates "hot dogs" and "long rolls" into a single long total', () => {
    const result = parseOrderStrict(
      'I need to get four hot dogs and maybe give me three 4-in and 15 long rolls and 12 sandwich',
    );
    expect(result).not.toBeNull();
    expect(result!.quantities.long).toBe(19);               // 4 hot dogs + 15 long rolls
    expect(result!.quantities['4-inch']).toBe(3);            // three 4-in
    expect(result!.quantities.institutional_sandwich).toBe(12);
  });

  it('maps "4-in" to 4-inch', () => {
    const result = parseOrderStrict('5 4-in');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(5);
  });

  it('maps "long rolls" to long', () => {
    const result = parseOrderStrict('20 long rolls');
    expect(result).not.toBeNull();
    expect(result!.quantities.long).toBe(20);
  });

  it('maps "hot dogs" (plural) to long', () => {
    const result = parseOrderStrict('6 hot dogs');
    expect(result).not.toBeNull();
    expect(result!.quantities.long).toBe(6);
  });

  it('accumulates buns + 4-inch into one total', () => {
    const result = parseOrderStrict('3 buns and 5 4-inch');
    expect(result).not.toBeNull();
    expect(result!.quantities['4-inch']).toBe(8);  // 3 + 5
  });

  // ── Product order (positional bare-number mapping) tests ─────
  it('maps "4 and 3" positionally with productOrder [toast, 4-inch]', () => {
    const result = parseOrderStrict('4 and 3', undefined, ['toast', '4-inch']);
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(4);
    expect(result!.quantities['4-inch']).toBe(3);
    expect(result!.confident).toBe(true);
  });

  it('maps "10, 5" positionally with productOrder [toast, 4-inch]', () => {
    const result = parseOrderStrict('10, 5', undefined, ['toast', '4-inch']);
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities['4-inch']).toBe(5);
  });

  it('maps three positional numbers with productOrder [toast, 4-inch, long]', () => {
    const result = parseOrderStrict('4 and 3 and 2', undefined, ['toast', '4-inch', 'long']);
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(4);
    expect(result!.quantities['4-inch']).toBe(3);
    expect(result!.quantities.long).toBe(2);
  });

  it('does NOT use productOrder when explicit product names are given', () => {
    const result = parseOrderStrict('toast 10', undefined, ['toast', '4-inch']);
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(10);
    expect(result!.quantities['4-inch']).toBeUndefined();
  });

  it('maps a single bare number to first product in productOrder when no defaultProduct', () => {
    const result = parseOrderStrict('12', undefined, ['toast', '4-inch']);
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(12);
  });

  it('prefers productOrder over defaultProduct for multiple bare numbers', () => {
    const result = parseOrderStrict('4 and 3', '4-inch', ['toast', '4-inch']);
    expect(result).not.toBeNull();
    expect(result!.quantities.toast).toBe(4);
    expect(result!.quantities['4-inch']).toBe(3);
  });

  it('ignores productOrder when bare numbers exceed product count', () => {
    const result = parseOrderStrict('4 and 3 and 2', undefined, ['toast']);
    expect(result).toBeNull();
  });
});

describe('isAffirmativeReply', () => {
  it('detects "Yes"', () => {
    expect(isAffirmativeReply('Yes')).toBe(true);
  });

  it('detects "Okay"', () => {
    expect(isAffirmativeReply('Okay')).toBe(true);
  });

  it('detects "yes" (case insensitive)', () => {
    expect(isAffirmativeReply('yes')).toBe(true);
  });

  it('detects "Sure"', () => {
    expect(isAffirmativeReply('Sure')).toBe(true);
  });

  it('detects "Yeah"', () => {
    expect(isAffirmativeReply('Yeah')).toBe(true);
  });

  it('detects "Sounds good"', () => {
    expect(isAffirmativeReply('Sounds good')).toBe(true);
  });

  it('detects "Please"', () => {
    expect(isAffirmativeReply('Please')).toBe(true);
  });

  it('detects "Ok!"', () => {
    expect(isAffirmativeReply('Ok!')).toBe(true);
  });

  it('detects "Yes please"', () => {
    expect(isAffirmativeReply('Yes please')).toBe(true);
  });

  it('detects thumbs up emoji', () => {
    expect(isAffirmativeReply('👍')).toBe(true);
  });

  it('does NOT match actual orders', () => {
    expect(isAffirmativeReply('toast 10, 4-inch 5')).toBe(false);
  });

  it('does NOT match long messages containing "yes"', () => {
    expect(isAffirmativeReply('Yes I would like to order 10 toast and 5 long rolls please')).toBe(false);
  });

  it('does NOT match random text', () => {
    expect(isAffirmativeReply('hello how are you')).toBe(false);
  });

  it('does NOT match numbers', () => {
    expect(isAffirmativeReply('12')).toBe(false);
  });
});

describe('isDeclineReply', () => {
  it('detects "we\'re good"', () => {
    expect(isDeclineReply("we're good")).toBe(true);
  });

  it('detects "We don\'t need anything this week"', () => {
    expect(isDeclineReply("We don't need anything this week")).toBe(true);
  });

  it('detects "nothing today"', () => {
    expect(isDeclineReply('nothing today')).toBe(true);
  });

  it('detects "skip this week"', () => {
    expect(isDeclineReply('skip this week')).toBe(true);
  });

  it('detects "No thanks"', () => {
    expect(isDeclineReply('No thanks')).toBe(true);
  });

  it('detects "No thank you"', () => {
    expect(isDeclineReply('No thank you')).toBe(true);
  });

  it('detects "not this week"', () => {
    expect(isDeclineReply('not this week')).toBe(true);
  });

  it('detects "we\'re all set"', () => {
    expect(isDeclineReply("we're all set")).toBe(true);
  });

  it('detects "none for us"', () => {
    expect(isDeclineReply('none for us')).toBe(true);
  });

  it('detects "pass this week"', () => {
    expect(isDeclineReply('pass this week')).toBe(true);
  });

  it('detects "we will pass"', () => {
    expect(isDeclineReply('we will pass')).toBe(true);
  });

  it('detects "not today"', () => {
    expect(isDeclineReply('not today')).toBe(true);
  });

  it('detects "we\'re closed"', () => {
    expect(isDeclineReply("we're closed")).toBe(true);
  });

  it('detects "closed this week"', () => {
    expect(isDeclineReply('closed this week')).toBe(true);
  });

  it('detects "taking this week off"', () => {
    expect(isDeclineReply('taking this week off')).toBe(true);
  });

  it('detects "off this week"', () => {
    expect(isDeclineReply('off this week')).toBe(true);
  });

  it('detects bare "no"', () => {
    expect(isDeclineReply('no')).toBe(true);
  });

  it('detects "No" (capitalized)', () => {
    expect(isDeclineReply('No')).toBe(true);
  });

  it('does NOT match actual orders', () => {
    expect(isDeclineReply('toast 10, 4-inch 5')).toBe(false);
  });

  it('does NOT match affirmative replies', () => {
    expect(isDeclineReply('Yes')).toBe(false);
  });

  it('does NOT match long messages', () => {
    expect(isDeclineReply('We don\'t need anything this week because we still have a ton of product left over from last week and the walk-in is packed full')).toBe(false);
  });

  it('does NOT match "same as last time"', () => {
    expect(isDeclineReply('same as last time')).toBe(false);
  });
});

describe('parseCorrectionRequest', () => {
  it('detects "change my toast to 15"', () => {
    const r = parseCorrectionRequest('change my toast to 15');
    expect(r).not.toBeNull();
    expect(r!.customerNameHint).toBeUndefined();
    expect(r!.orderText).toBe('toast to 15');
  });

  it('detects admin correction: "change Waldo\'s toast to 15"', () => {
    const r = parseCorrectionRequest("change Waldo's toast to 15");
    expect(r).not.toBeNull();
    expect(r!.customerNameHint).toBe('Waldo');
    expect(r!.orderText).toBe('toast to 15');
  });

  it('detects correction with preamble: "Oh crap, Change 3 trays sandwich to 4 trays sandwich"', () => {
    const r = parseCorrectionRequest('Oh crap, Change 3 trays sandwich to 4 trays sandwich');
    expect(r).not.toBeNull();
    expect(r!.orderText).toBe('3 trays sandwich to 4 trays sandwich');
  });

  it('detects "Hey, update my toast to 10"', () => {
    const r = parseCorrectionRequest('Hey, update my toast to 10');
    expect(r).not.toBeNull();
    expect(r!.orderText).toBe('toast to 10');
  });

  it('returns null for regular orders', () => {
    expect(parseCorrectionRequest('toast 10, 4-inch 5')).toBeNull();
  });

  it('returns null for "hello"', () => {
    expect(parseCorrectionRequest('hello')).toBeNull();
  });
});

describe('preprocessCorrectionText', () => {
  it('converts "toast to 15" → "toast 15"', () => {
    expect(preprocessCorrectionText('toast to 15')).toBe('toast 15');
  });

  it('handles "3 trays sandwich to 4 trays sandwich" — keeps only the new quantity', () => {
    expect(preprocessCorrectionText('3 trays sandwich to 4 trays sandwich')).toBe('4 trays sandwich');
  });

  it('handles "10 toast to 5 toast"', () => {
    expect(preprocessCorrectionText('10 toast to 5 toast')).toBe('5 toast');
  });
});
