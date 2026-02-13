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
  '4-inch': '4-inch',
  'four-inch': '4-inch',
  'four-inch hamburger bun': '4-inch',
  'four-inch bun': '4-inch',
  'bun': '4-inch',
  'long': 'long',
  'hot dog': 'long',
  'institutional_sandwich': 'institutional_sandwich',
  'institutional sandwich': 'institutional_sandwich',
  'sandwich': 'institutional_sandwich',
  'three-inch bun': 'institutional_sandwich',
};

// ── Strict regex parser ─────────────────────────────────────────
// Accepts formats like:
//   "chicken 10, ribs 5"
//   "10 chicken, 5 ribs"
//   "chicken: 10 | ribs: 5"

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseOrderStrict(text: string, defaultProduct?: string): ParsedOrder | null {
  const quantities: Record<string, number> = {};
  let matchCount = 0;

  const normalized = text.toLowerCase().replace(/_/g, ' ');

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

  for (const { label, product } of namePairs) {
    if (quantities[product] !== undefined) continue; // already matched via a prior alias
    const escaped = escapeRegex(label);
    const patterns = [
      new RegExp(`${escaped}\\s*[:=]?\\s*(\\d+)`, 'i'),
      new RegExp(`(\\d+)\\s+${escaped}`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        quantities[product] = parseInt(match[1], 10);
        matchCount++;
        break;
      }
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
- "four-inch hamburger bun", "four-inch bun", "bun", "four-inch" → 4-inch
- "hot dog" → long
- "sandwich", "three-inch bun" → institutional_sandwich
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

export async function parseOrder(text: string, defaultProduct?: string): Promise<ParsedOrder> {
  // Try strict regex first (free and fast)
  const strict = parseOrderStrict(text, defaultProduct);
  if (strict) {
    logger.info('Order parsed with strict parser', { result: strict });
    return strict;
  }

  // Fall back to AI
  logger.info('Strict parser found no matches — falling back to AI', { input: text });
  return parseOrderWithAI(text);
}
