import Anthropic from '@anthropic-ai/sdk';

// Instantiated once and reused across requests (server-side only)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default anthropic;
