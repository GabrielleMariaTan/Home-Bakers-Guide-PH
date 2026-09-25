import { createOpenAI } from '@ai-sdk/openai';

/**
 * OpenAI provider. OPENAI_BASE_URL is optional: leave it unset for a normal
 * OpenAI key, or set it to your gateway's URL (e.g. the Vocareum endpoint
 * provided by the course) when the key was issued through a proxy.
 * Server-only — never import this from a client component.
 */
export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});
