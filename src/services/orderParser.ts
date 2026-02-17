import OpenAI from 'openai';
import { config } from '../config';
import logger from '../logger';

export interface ParsedOrder {
  quantities: Record<string, number>;
  confident: boolean;
}

// ── Product aliases ─────────────────────────────────────────────
// Maps synonym → canonical product name.
// Keys must be lowercase. The canonical name itself is included.
const PRODUCT_ALIASES: Record<string, string> = {
  'toast': 'toast',
  'texas toast': 'toast',
  'texas': 'toast',
  '4-inch': '4-inch',
  '4-in': '4-inch',
  'four-inch': '4-inch',
  'four-inch hamburger bun': '4-inch',
  'four-inch bun': '4-inch',
  'four inch': '4-inch',
  'bun': '4-inch',
  'buns': '4-inch',
  'long': 'long',
  'long roll': 'long',
  'long rolls': 'long',
  'hot dog': 'long',
  'hot dogs': 'long',
  'institutional_sandwich': 'institutional_sandwich',
  'institutional sandwich': 'institutional_sandwich',
  'sandwich': 'institutional_sandwich',
  'sandwiches': 'institutional_sandwich',
  'three-inch bun': 'institutional_sandwich',
  'dinner_rolls': 'dinner_rolls',
  'dinner rolls': 'dinner_rolls',
  'dinner': 'dinner_rolls',
};

// ── Word-number conversion ──────────────────────────────────────
// Converts spoken/typed number words into digits so the regex parser
// can handle casual messages like "five toast, two long".

const WORD_NUMBERS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20', thirty: '30',
  forty: '40', fifty: '50', sixty: '60', seventy: '70',
  eighty: '80', ninety: '90', hundred: '100',
  // Common misspellings / voice-to-text quirks
  too: '2', to: '2', for: '4', fore: '4', ate: '8',
};

// Compound numbers like "twenty five" → "25"
const COMPOUND_PATTERN = /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ]?(one|two|three|four|five|six|seven|eight|nine)\b/gi;

function wordsToDigits(text: string): string {
  // First handle compound numbers ("twenty five" → "25")
  let result = text.replace(COMPOUND_PATTERN, (_match, tens, ones) => {
    const t = parseInt(WORD_NUMBERS[tens.toLowerCase()] || '0', 10);
    const o = parseInt(WORD_NUMBERS[ones.toLowerCase()] || '0', 10);
    return String(t + o);
  });

  // Then handle standalone word-numbers.
  // Use word boundaries, but be careful with "to" and "for" — only convert them
  // when they appear right next to a product name (handled by context in the regex step).
  // For the safe words (not ambiguous), convert them directly.
  const safeWords = { ...WORD_NUMBERS };
  // "to", "for", "ate" are too ambiguous on their own — only "too" near a product is converted
  delete safeWords.to;
  delete safeWords.for;
  delete safeWords.fore;
  delete safeWords.ate;

  // Replace safe word-numbers with digits, but NOT when they're part of a
  // hyphenated product name like "three-inch" or "four-inch"
  for (const [word, digit] of Object.entries(safeWords)) {
    const pattern = new RegExp(`\\b${word}\\b(?!-)`, 'gi');
    result = result.replace(pattern, digit);
  }

  return result;
}

// ── Strict regex parser ─────────────────────────────────────────
// Accepts formats like:
//   "chicken 10, ribs 5"
//   "10 chicken, 5 ribs"
//   "chicken: 10 | ribs: 5"
//   "Thank you, can I get 5 toast, 6 4-inch, two long"

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseOrderStrict(text: string, defaultProduct?: string, productOrder?: string[]): ParsedOrder | null {
  const quantities: Record<string, number> = {};
  let matchCount = 0;

  // Normalize: lowercase, underscores to spaces, then convert word-numbers to digits
  const normalized = wordsToDigits(text.toLowerCase().replace(/_/g, ' '));

  // Build a list of (name-to-match, canonical-product) pairs.
  // Aliases first (longer phrases matched before shorter ones), then bare product names.
  const namePairs: { label: string; product: string }[] = [];

  // Add aliases sorted by length descending so "four-inch hamburger bun" matches before "bun"
  const sortedAliases = Object.entries(PRODUCT_ALIASES).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [alias, canonical] of sortedAliases) {
    if (config.products.includes(canonical)) {
      namePairs.push({ label: alias, product: canonical });
    }
  }

  // Add remaining product names that have no aliases
  for (const product of config.products) {
    const displayName = product.replace(/_/g, ' ');
    if (!namePairs.some((np) => np.label === displayName)) {
      namePairs.push({ label: displayName, product });
    }
  }

  // Track which regions of the text have already been matched so we don't
  // double-count the same substring via a different alias.
  const matchedRegions: { start: number; end: number }[] = [];

  function overlapsExisting(start: number, end: number): boolean {
    return matchedRegions.some((r) => start < r.end && end > r.start);
  }

  // Pass 1: strict patterns — no comma tolerance, handles standard formats like
  // "toast 10, long 5" and "10 toast, 5 long".
  // Accumulates quantities when different aliases for the same product appear
  // (e.g. "4 hot dogs and 15 long rolls" → long = 19).
  for (const { label, product } of namePairs) {
    const escaped = escapeRegex(label);
    const patterns = [
      new RegExp(`(\\d+)\\s+${escaped}\\b`, 'gi'),        // "10 toast"
      new RegExp(`${escaped}\\s*[:=]?\\s*(\\d+)`, 'gi'),   // "toast 10" or "toast: 10"
    ];
    for (const pattern of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(normalized)) !== null) {
        if (overlapsExisting(m.index, m.index + m[0].length)) continue;
        const qty = parseInt(m[1], 10);
        quantities[product] = (quantities[product] || 0) + qty;
        matchedRegions.push({ start: m.index, end: m.index + m[0].length });
        matchCount++;
      }
    }
  }

  // Pass 2: comma-tolerant patterns for products not yet matched at all.
  // Handles casual formats like "6, 4-inch" or "toast, 10" where a comma
  // sits between the number and product name.
  for (const { label, product } of namePairs) {
    const escaped = escapeRegex(label);
    const patterns = [
      new RegExp(`(\\d+),\\s*${escaped}\\b`, 'gi'),        // "6, 4-inch"
      new RegExp(`${escaped},\\s*(\\d+)`, 'gi'),            // "toast, 10"
    ];
    for (const pattern of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(normalized)) !== null) {
        if (overlapsExisting(m.index, m.index + m[0].length)) continue;
        const qty = parseInt(m[1], 10);
        quantities[product] = (quantities[product] || 0) + qty;
        matchedRegions.push({ start: m.index, end: m.index + m[0].length });
        matchCount++;
      }
    }
  }

  // If no products matched but the message contains bare numbers, try positional mapping.
  // A customer with productOrder: ["toast", "4-inch"] who texts "4 and 3" gets
  // { toast: 4, "4-inch": 3 }.
  if (matchCount === 0 && productOrder && productOrder.length > 0) {
    const bareNumbers = [...normalized.matchAll(/\b(\d+)\b/g)].map((m) => parseInt(m[1], 10));
    if (bareNumbers.length > 0 && bareNumbers.length <= productOrder.length) {
      for (let i = 0; i < bareNumbers.length; i++) {
        quantities[productOrder[i]] = (quantities[productOrder[i]] || 0) + bareNumbers[i];
      }
      logger.info('Bare numbers matched to product order', {
        bareNumbers,
        productOrder,
        quantities,
      });
      return { quantities, confident: true };
    }
  }

  // If no products matched but the message is just a number (e.g. "12" or "I'll take 12"),
  // and the customer has a default product, assume they mean that product.
  if (matchCount === 0 && defaultProduct) {
    const bareNumber = normalized.match(/\b(\d+)\b/);
    if (bareNumber) {
      quantities[defaultProduct] = parseInt(bareNumber[1], 10);
      logger.info('Bare number matched to default product', {
        qty: quantities[defaultProduct],
        defaultProduct,
      });
      return { quantities, confident: true };
    }
  }

  if (matchCount === 0) return null;

  return { quantities, confident: true };
}

// ── Affirmative reply detection ──────────────────────────────────
// Detects replies like "Yes", "Okay", "Sure" that confirm interest
// but don't contain actual order quantities.

const AFFIRMATIVE_PATTERNS = [
  /^\s*(yes|yeah|yep|yup|yea|ya|yah)\b/i,
  /^\s*(ok|okay|okey|ok!|okay!)\b/i,
  /^\s*(sure|sure!)\b/i,
  /^\s*(please|pls)\b/i,
  /^\s*(correct|right|that's right|thats right)\b/i,
  /^\s*(sounds good|sounds great|perfect)\b/i,
  /^\s*(absolutely|definitely|of course)\b/i,
  /^\s*(will do|go ahead|let's do it|lets do it)\b/i,
  /^\s*(👍|✅|👌)\s*$/,
];

export function isAffirmativeReply(text: string): boolean {
  const trimmed = text.trim();
  // Only match short messages — a long reply with "yes" embedded is probably an order attempt
  if (trimmed.length > 40) return false;
  return AFFIRMATIVE_PATTERNS.some((p) => p.test(trimmed));
}

// ── AI-assisted parser (OpenAI fallback) ────────────────────────

export async function parseOrderWithAI(text: string): Promise<ParsedOrder> {
  if (!config.openai.apiKey) {
    logger.warn('OpenAI API key not configured — cannot use AI parser');
    return { quantities: {}, confident: false };
  }

  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  const systemPrompt = `You are an order-parsing assistant. The customer texted their food order.
Extract quantities for each product. Available products: ${config.products.join(', ')}.
Important synonyms — always map these to the canonical product name:
- "texas toast", "texas" → toast
- "four-inch hamburger bun", "four-inch bun", "bun", "four-inch" → 4-inch
- "hot dog" → long
- "sandwich", "three-inch bun" → institutional_sandwich
- "dinner", "dinner rolls" → dinner_rolls
Return ONLY valid JSON in this exact format: {"quantities": {"product_name": number}, "confident": true/false}
Set confident to false if the message is ambiguous or doesn't clearly reference any products.
If a product isn't mentioned, omit it (don't set it to 0).`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 256,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    });

    const content = completion.choices[0]?.message?.content?.trim() || '{}';
    // Strip markdown code fences if present
    const jsonStr = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(jsonStr);

    logger.info('AI parsed order', { input: text, result: parsed });
    return {
      quantities: parsed.quantities || {},
      confident: parsed.confident ?? false,
    };
  } catch (err) {
    logger.error('AI order parsing failed', { error: err, input: text });
    return { quantities: {}, confident: false };
  }
}

// ── Combined parser: strict first, then AI fallback ─────────────

export async function parseOrder(text: string, defaultProduct?: string, productOrder?: string[]): Promise<ParsedOrder> {
  // Try strict regex first (free and fast)
  const strict = parseOrderStrict(text, defaultProduct, productOrder);
  if (strict) {
    logger.info('Order parsed with strict parser', { result: strict });
    return strict;
  }

  // Fall back to AI
  logger.info('Strict parser found no matches — falling back to AI', { input: text });
  return parseOrderWithAI(text);
}
