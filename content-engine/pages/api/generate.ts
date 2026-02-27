import type { NextApiRequest, NextApiResponse } from 'next';
import anthropic from '@/lib/anthropic';
import type { Idea, GenerateRequest } from '@/types';

const SYSTEM_PROMPT =
  'You are an elite TikTok growth strategist specializing in short-form affiliate content. ' +
  'Generate high-converting content ideas optimized for hook retention, emotional engagement, and monetization.';

function buildUserPrompt({ topic, audience, tone, goal }: GenerateRequest): string {
  return `Topic: ${topic}
Target Audience: ${audience}
Tone: ${tone}
Primary Goal: ${goal}

Generate exactly 3 TikTok video concepts.

Return STRICT JSON only with this structure:
[
  {
    "title": "...",
    "hook": "...",
    "script_outline": "...",
    "caption": "...",
    "cta": "...",
    "affiliate_angle": "..."
  }
]

Do not include explanations.`;
}

function safeParseIdeas(raw: string): Idea[] | null {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    return parsed as Idea[];
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { topic, audience, tone, goal } = req.body as GenerateRequest;

  if (!topic || !audience || !tone || !goal) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: API key not set.' });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt({ topic, audience, tone, goal }) }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return res.status(500).json({ error: 'Unexpected response format from AI.' });
    }

    const ideas = safeParseIdeas(textBlock.text);
    if (!ideas) {
      return res.status(500).json({ error: 'Could not parse AI response. Please try again.' });
    }

    // Attach stable IDs so the Kanban board can track items
    const ideasWithIds: Idea[] = ideas.map((idea, i) => ({
      ...idea,
      id: `idea-${Date.now()}-${i}`,
    }));

    return res.status(200).json({ ideas: ideasWithIds });
  } catch (err) {
    console.error('Claude API error:', err);
    return res.status(500).json({ error: 'Failed to generate ideas. Please try again.' });
  }
}
