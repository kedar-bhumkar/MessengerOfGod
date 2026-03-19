import { openaiClient } from './client.js';
import { buildPrompt } from './prompt-builder.js';
import type { GenerationRequest } from './prompt-builder.js';
import { withRetry } from '../utils/retry.js';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';

export interface GenerationResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Generate a personalized message for a contact using OpenAI.
 *
 * Builds the prompt from the generation request, calls the chat completions API,
 * and returns the generated text along with token usage metadata.
 * Wrapped in retry logic (3 attempts) to handle transient API failures.
 */
export async function generateMessage(request: GenerationRequest): Promise<GenerationResult> {
  const { systemPrompt, userPrompt } = buildPrompt(request);

  logger.debug(
    { contactName: request.contactName, relationship: request.relationship },
    'Generating message for contact'
  );

  const completion = await withRetry(
    async () => {
      return openaiClient.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 300,
      });
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    }
  );

  let text = completion.choices[0]?.message?.content ?? '';

  // Trim any surrounding quotes the model may have added
  text = text.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  const result: GenerationResult = {
    text,
    model: completion.model,
    promptTokens: completion.usage?.prompt_tokens ?? 0,
    completionTokens: completion.usage?.completion_tokens ?? 0,
  };

  logger.debug(
    {
      contactName: request.contactName,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      messageLength: result.text.length,
    },
    'Message generated successfully'
  );

  return result;
}
