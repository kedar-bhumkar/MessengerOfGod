import OpenAI from 'openai';
import { env } from '../env.js';

/**
 * Singleton OpenAI client instance configured from environment variables.
 * Used by the message generator to call chat completion endpoints.
 */
export const openaiClient = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});
