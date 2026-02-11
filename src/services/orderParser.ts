import OpenAI from 'openai';
import { config } from '../config';
import logger from '../logger';

export interface ParsedOrder {
  quantities: Record<string, number>;
  confident: boolean;
}

// ── Strict regex parser ─────────────────────────────────────────
// Accepts formats like:
//   "chicken 10, ribs 5"
//   "10 chicken, 5 ribs"
//   "chicken: 10 | ribs: 5"

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseOrderStrict(text: string): ParsedOrder | null {
  const quantities: Record<string, number> = {};
  let matchCount = 0;

  const normalized = text.toLowerCase().replace(/_/g, ' ');

  for (const product of config.products) {
    const displayName = product.replace(/_/g, ' ');
    const escaped = escapeRegex(displayName);
    // "toast 10" or "toast: 10" or "10 toast" or "4-inch 10" etc.
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

export async function parseOrder(text: string): Promise<ParsedOrder> {
  // Try strict regex first (free and fast)
  const strict = parseOrderStrict(text);
  if (strict) {
    logger.info('Order parsed with strict parser', { result: strict });
    return strict;
  }

  // Fall back to AI
  logger.info('Strict parser found no matches — falling back to AI', { input: text });
  return parseOrderWithAI(text);
}
