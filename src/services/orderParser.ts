import OpenAI from 'openai';
import { config } from '../config';
import logger from '../logger';

export interface ParsedOrder {
  quantities: Record<string, number>;
  confident: boolean;
  declined?: boolean; // true when AI detects the customer is declining/skipping their order
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
  '4 in': '4-inch',
  '4 inch': '4-inch',
  '4in': '4-inch',
  '4-inch buns': '4-inch',
  '4-inch bun': '4-inch',
  '4 inch buns': '4-inch',
  '4 inch bun': '4-inch',
  '4-in buns': '4-inch',
  '4-in bun': '4-inch',
  '4 in buns': '4-inch',
  '4 in bun': '4-inch',
  '4in buns': '4-inch',
  '4in bun': '4-inch',
  'four-inch': '4-inch',
  'four-inch hamburger bun': '4-inch',
  'four-inch buns': '4-inch',
  'four-inch bun': '4-inch',
  'four inch': '4-inch',
  'four inch buns': '4-inch',
  'four inch bun': '4-inch',
  'bun': '4-inch',
  'buns': '4-inch',
  'long': 'long',
  'long roll': 'long',
  'long rolls': 'long',
  'hot dog': 'long',
  'hot dogs': 'long',
  'hotdog': 'long',
  'hotdogs': 'long',
  'institutional_sandwich': 'institutional_sandwich',
  'institutional sandwich': 'institutional_sandwich',
  'sandwich': 'institutional_sandwich',
  'sandwiches': 'institutional_sandwich',
  'sand roll': 'institutional_sandwich',
  'sand rolls': 'institutional_sandwich',
  'three-inch bun': 'institutional_sandwich',
  'dinner_rolls': 'dinner_rolls',
  'dinner rolls': 'dinner_rolls',
  'dinner': 'dinner_rolls',
  'hoagie': 'hoagie',
  'hoagies': 'hoagie',
  'sub': 'hoagie',
  'subs': 'hoagie',
  'sub roll': 'hoagie',
  'sub rolls': 'hoagie',
  'sausage roll': 'hoagie',
  'sausage rolls': 'hoagie',
  'top_slice': 'top_slice',
  'top slice': 'top_slice',
  'top slices': 'top_slice',
  'marty': 'marty',
  'plain_marty': 'plain_marty',
  'plain marty': 'plain_marty',
  'marty no seeds': 'plain_marty',
  'marty no seed': 'plain_marty',
  '5-inch': '5-inch',
  '5-in': '5-inch',
  '5 inch': '5-inch',
  '5 in': '5-inch',
  '5in': '5-inch',
  'five-inch': '5-inch',
  'five inch': '5-inch',
  '5-inch bun': '5-inch',
  '5-inch buns': '5-inch',
  '5 inch bun': '5-inch',
  '5 inch buns': '5-inch',
  '5in bun': '5-inch',
  '5in buns': '5-inch',
  '5-in bun': '5-inch',
  '5-in buns': '5-inch',
  'potato_bread': 'potato_bread',
  'potato bread': 'potato_bread',
  'potato': 'potato_bread',
  'regular bread': 'potato_bread',
  'regular sandwich bread': 'potato_bread',
  'sandwich bread': 'potato_bread',
  'slice bread': 'potato_bread',
  'sliced bread': 'potato_bread',
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
  // "to", "too", "for", "ate" are too ambiguous on their own — skip auto-conversion
  // ("too" caused "If it is not too late" → long: 2 via the bare-number fallback)
  delete safeWords.to;
  delete safeWords.too;
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

  // Normalize: lowercase, underscores to spaces, strip tray units, then convert word-numbers to digits
  let cleaned = text.toLowerCase().replace(/_/g, ' ');
  // "a tray of toast" → "1 toast", "3 trays of toast" → "3 toast", "3 trays toast" → "3 toast"
  cleaned = cleaned.replace(/\ba\s+trays?\s+(of\s+)?/gi, '1 ');
  cleaned = cleaned.replace(/\btrays?\s+(of\s+)?/gi, '');
  // "4- inch" or "4- in" → "4-inch" / "4-in" (space after hyphen in product names)
  cleaned = cleaned.replace(/(\d+)-\s+/g, '$1-');
  // "(5) 4 inch" → "5 4 inch" — strip parentheses around quantities
  cleaned = cleaned.replace(/\((\d+)\)/g, '$1');
  const normalized = wordsToDigits(cleaned);

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
      new RegExp(`(\\d+)[ \\t]+${escaped}\\b`, 'gi'),           // "10 toast"
      new RegExp(`(\\d+)[ \\t]*[-:=][ \\t]*${escaped}\\b`, 'gi'), // "5 - toast", "5: toast"
      new RegExp(`${escaped}[ \\t]*[-:=]?[ \\t]*(\\d+)`, 'gi'),   // "toast 10", "toast: 10", "toast -10"
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
      new RegExp(`(\\d+),[ \\t]*${escaped}\\b`, 'gi'),        // "6, 4-inch"
      new RegExp(`${escaped},[ \\t]*(\\d+)`, 'gi'),            // "toast, 10"
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
  if (matchCount === 0 && productOrder && productOrder.length > 0 && normalized.length <= 80) {
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
  if (matchCount === 0 && defaultProduct && normalized.length <= 80) {
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

// ── Repeat-order detection ──────────────────────────────────────
// Detects replies like "same as last time", "repeat", "the usual", etc.

const REPEAT_ORDER_PATTERNS = [
  /\bsame\s*(as\s*(last|before|previous))?\s*(time|order)?\b/i,
  /\bsame\s+thing\b/i,
  /\brepeat\b/i,
  /\blast\s+order\b/i,
  /\bprevious\s+order\b/i,
  /\b(the\s+)?usual\b/i,
  /\bwhat\s+i\s+(got|had|ordered)\s+(last|before)\b/i,
  /\bgive\s+me\s+(the\s+)?same\b/i,
  /\bdo\s+(the\s+)?same\b/i,
];

// ── Message reaction detector ────────────────────────────────────
// iOS and Android both send a text message when a user "reacts" to a
// message.  The body contains the quoted original text, which may
// include order quantities and cause false parses.
//   Android:  👍 to "Heads up — an order has been placed..."
//   iOS:      Liked "Your order for Thursday is locked in..."
// We detect these and stay silent rather than treating them as orders.

export function isReactionMessage(text: string): boolean {
  const trimmed = text.trim();
  // Android: any short prefix (emoji or word) + ' to "' + quoted content
  if (/^.{1,20}\s+to\s+"/i.test(trimmed)) return true;
  // iOS reaction verbs
  if (/^(Liked|Loved|Laughed at|Emphasized|Questioned|Disliked)\s+"/i.test(trimmed)) return true;
  return false;
}

export function isRepeatOrderRequest(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 80) return false;
  return REPEAT_ORDER_PATTERNS.some((p) => p.test(trimmed));
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

// ── "Called in" detection ─────────────────────────────────────────
// Detects replies like "Called in", "I called it in", "called the order in"
// These mean the customer placed the order by phone and the admin needs
// to manually enter quantities.

const CALLED_IN_PATTERNS = [
  /^\s*call(ed)?\s*(it\s+)?in\b/i,
  /^\s*i\s+call(ed)?\s*(it\s+|the\s+order\s+)?in\b/i,
  /^\s*already\s+call(ed)?\s*(it\s+)?in\b/i,
  /^\s*phon(ed|e)\s*(it\s+)?in\b/i,
];

export function isCalledInReply(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 60) return false;
  return CALLED_IN_PATTERNS.some((p) => p.test(trimmed));
}

// ── Decline / skip-order detection ──────────────────────────────
// Detects replies like "we're good", "nothing today", "skip this week", etc.

const DECLINE_PATTERNS = [
  /\b(no|not|don'?t|dont)\s+(need|want|order|ordering)\b/i,
  /\bno\s+bread\b/i,           // "no bread", "no bread ty", "no bread this week"
  /\bno\s+order\b/i,           // "no order today"
  /\bnothing\s*(today|this\s*(week|time)|right\s*now|for\s*(us|me|today|now))?\b/i,
  /\bwe'?re\s+(good|fine|ok|okay|all\s*(good|set))\b/i,
  /\bi'?m\s+(good|fine|ok|okay|all\s*(good|set))\b/i,
  /\ball\s*(good|set)\b/i,
  /\bskip\s*(this)?\s*(week|time|today|order|us)?\b/i,
  /\bnone\s*(today|this\s*(week|time)|for\s*(us|me|today|now))?\b/i,
  /\bpass\s*(this)?\s*(week|time|today)?\b/i,
  /\bnot\s*this\s*(week|time)\b/i,
  /\bnot\s*today\b/i,
  /\bno\s*thank(s| you)\b/i,
  /^\s*no\s*$/i,
  /^\s*0\s*$/,         // bare "0" — no order this week
  /^\s*zero\s*$/i,     // "zero"
  /\bwe\s*(will)?\s*pass\b/i,
  /\bwe'?re\s+closed\b/i,
  /\bclosed\s*(today|this\s*week)?\b/i,
  /\btak(e|ing)\s*(the|this)?\s*(week|day)\s*off\b/i,
  /\boff\s*this\s*(week|time)\b/i,
];

export function isDeclineReply(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 120) return false;
  return DECLINE_PATTERNS.some((p) => p.test(trimmed));
}

// ── Order correction detection ──────────────────────────────────
// Detects messages like:
//   Admin:    "change Waldo's toast to 15"
//   Customer: "change my toast to 15" / "change toast to 15"

export interface CorrectionRequest {
  customerNameHint?: string; // undefined = self-correction
  orderText: string;         // the portion describing new quantities
}

// Allow optional preamble before the keyword, e.g. "Oh crap, change ..." or "Hey, update ..."
const CORRECTION_PREFIX = /^(.*?\b)?(change|update|fix|correct|add)\s+(that\s+)?/i;

export function parseCorrectionRequest(text: string): CorrectionRequest | null {
  const trimmed = text.trim();
  const prefixMatch = trimmed.match(CORRECTION_PREFIX);
  if (!prefixMatch) return null;

  const keyword = prefixMatch[2].toLowerCase();
  const afterKeyword = trimmed.replace(CORRECTION_PREFIX, '').trim();
  if (!afterKeyword) return null;

  // "add" uses format: "add <qty> <product> to <customer name>"
  // e.g. "Add four 4 in to dad's bbq"
  if (keyword === 'add') {
    const addToMatch = afterKeyword.match(/^(.+?)\s+to\s+(.+)$/i);
    if (addToMatch) {
      return { customerNameHint: addToMatch[2].trim(), orderText: addToMatch[1].trim() };
    }
    // No "to <customer>" → self-correction: "add 4 toast"
    return { orderText: afterKeyword };
  }

  // Self-correction: "my order to ..." or "my toast to 15"
  const myMatch = afterKeyword.match(/^my\s+(order\s+to\s+)?(.+)$/i);
  if (myMatch) {
    return { orderText: myMatch[2].trim() };
  }

  // Admin correction: "<name>'s ..." — capture everything before the first possessive 's
  const possessiveMatch = afterKeyword.match(/^(.+?)[''']s?\s+(order\s+to\s+)?(.+)$/i);
  if (possessiveMatch) {
    const nameHint = possessiveMatch[1].trim();
    const orderText = possessiveMatch[3].trim();
    // "my" isn't a customer name
    if (nameHint.toLowerCase() === 'my') {
      return { orderText };
    }
    return { customerNameHint: nameHint, orderText };
  }

  // "order to ..." (no name, no "my")
  const orderToMatch = afterKeyword.match(/^order\s+to\s+(.+)$/i);
  if (orderToMatch) {
    return { orderText: orderToMatch[1].trim() };
  }

  // Fallback — treat whole remaining text as self-correction
  return { orderText: afterKeyword };
}

// Preprocess correction text so "toast to 15" becomes "toast 15"
// Also handles "3 trays sandwich to 4 trays sandwich" — strip the "old value to" part
export function preprocessCorrectionText(text: string): string {
  // Pattern: "<old qty> <product> to <new qty> <product>" — keep only the part after "to"
  const oldToNew = text.match(/^\d+\s+.+?\s+to\s+(\d+\s+.+)$/i);
  if (oldToNew) {
    return oldToNew[1];
  }
  return text.replace(/\s+to\s+(\d)/g, ' $1');
}

// ── Admin order-on-behalf-of detection ──────────────────────────
// Admin texts:
//   "order for thumb suckers 10 toast 5 hoagie"
//   "order for 13529883447 toast 10 hoagie 5"
//   "order for phone number 1352-988-3447 toast 10"

export interface AdminOrderRequest {
  customerIdentifier: string; // name hint or raw phone string
  isPhone: boolean;
  orderText: string;
}

const ADMIN_ORDER_PREFIX = /^(?:.*?\b)?(?:place\s+)?order\s+for\s+(?:phone\s+(?:number\s+)?)?/i;

export function parseAdminOrderRequest(text: string): AdminOrderRequest | null {
  const trimmed = text.trim();
  if (!ADMIN_ORDER_PREFIX.test(trimmed)) return null;

  const afterPrefix = trimmed.replace(ADMIN_ORDER_PREFIX, '').trim();
  if (!afterPrefix) return null;

  // Detect phone: first token has 7+ digits, or starts with + / (
  const firstToken = afterPrefix.split(/\s+/)[0];
  const digitCount = (firstToken.match(/\d/g) || []).length;
  const isPhoneToken = digitCount >= 7 || firstToken.startsWith('+') || firstToken.startsWith('(');

  if (isPhoneToken) {
    const spaceIdx = afterPrefix.indexOf(' ');
    if (spaceIdx === -1) return null; // phone only, no order text
    return {
      customerIdentifier: afterPrefix.slice(0, spaceIdx).trim(),
      isPhone: true,
      orderText: afterPrefix.slice(spaceIdx + 1).trim(),
    };
  }

  // Name-based: scan words until we hit a digit or a recognized product keyword
  const words = afterPrefix.split(/\s+/);
  let nameEndIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (/^\d+$/.test(words[i])) { nameEndIdx = i; break; }
    const lower = words[i].toLowerCase();
    if (PRODUCT_ALIASES[lower] || config.products.includes(lower)) { nameEndIdx = i; break; }
  }

  if (nameEndIdx <= 0) return null; // no name found, or name starts with a product word

  return {
    customerIdentifier: words.slice(0, nameEndIdx).join(' '),
    isPhone: false,
    orderText: words.slice(nameEndIdx).join(' '),
  };
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
- "sandwich", "sand rolls", "three-inch bun" → institutional_sandwich
- "dinner", "dinner rolls" → dinner_rolls
- "hoagies", "sub", "subs", "sub roll", "sub rolls", "sausage roll", "sausage rolls" → hoagie
- "top slice", "top slices" → top_slice
- "marty no seeds", "marty no seed" → plain_marty
- "plain marty" → plain_marty
- "5 inch", "5in", "five inch", "five-inch", "5-in" → 5-inch
If the customer is clearly declining, skipping, or not ordering (e.g. "no bread this week", "nothing for us", "we're good", "not until next week", "skip us", "closed today"), set "declined" to true and return empty quantities.
Return ONLY valid JSON in this exact format: {"quantities": {"product_name": number}, "confident": true/false, "declined": false}
Set confident to false if the message is ambiguous or doesn't clearly reference any products.
Set declined to true if the customer is clearly not placing an order this week.
If a product isn't mentioned, omit it from quantities (don't set it to 0).`;

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
      declined: parsed.declined ?? false,
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
