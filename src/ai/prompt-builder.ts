import type { ConversationMessage } from '../db/types.js';

export interface GenerationRequest {
  contactName: string;
  relationship: string;
  salutationOptions: string[];
  conversationHistory: ConversationMessage[];
  notes?: string | null;
  daysSinceLastMessage?: number;
}

export interface PromptPair {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Build a system + user prompt pair from the contact context.
 *
 * The system prompt establishes the assistant persona.
 * The user prompt provides all the context needed to generate
 * a natural, human-feeling message for a specific contact.
 */
export function buildPrompt(request: GenerationRequest): PromptPair {
  const systemPrompt =
    'You are a personal messaging assistant. Generate a natural, warm message ' +
    'for the user to send to their contact. The message should feel genuinely ' +
    'human, not templated or robotic.';

  const sections: string[] = [];

  // Contact identity
  sections.push(`Contact name: ${request.contactName}`);
  sections.push(`Relationship: ${request.relationship}`);

  // Salutation options
  if (request.salutationOptions.length > 0) {
    sections.push(
      `Available salutations (pick one or vary): ${request.salutationOptions.join(', ')}`
    );
  }

  // Notes about the person
  if (request.notes) {
    sections.push(`Notes about this person: ${request.notes}`);
  }

  // Days since last message
  if (request.daysSinceLastMessage !== undefined && request.daysSinceLastMessage !== null) {
    sections.push(`Days since last message: ${request.daysSinceLastMessage}`);
  }

  // Conversation history
  if (request.conversationHistory.length > 0) {
    const historyLines = request.conversationHistory.map((msg) => {
      const prefix = msg.direction === 'outbound' ? 'You' : 'Them';
      return `  ${prefix} (${msg.created_at}): ${msg.message}`;
    });
    sections.push(`Recent conversation history:\n${historyLines.join('\n')}`);
  } else {
    sections.push('No recent conversation history available.');
  }

  // Generation instructions
  sections.push(
    [
      'Instructions:',
      '- Keep it brief: 1-3 sentences for friends and family, slightly more formal for colleagues or mentors.',
      '- Reference recent conversation if relevant.',
      '- Do not repeat the exact same patterns or phrasing from previous messages.',
      '- If there is no recent conversation history, start with a natural check-in.',
      '- CRITICAL: Return ONLY the message text, nothing else. No quotes, no prefix, no explanation, just the message.',
    ].join('\n')
  );

  const userPrompt = sections.join('\n\n');

  return { systemPrompt, userPrompt };
}
