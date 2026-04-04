// ============================================================================
// Action Executor
// Spins up a Claude sub-agent (via Anthropic API + tool use) to interpret and
// execute a plain-language action directive from the config row.
//
// Claude has two tools:
//   bash          — runs shell commands on the local machine
//   return_result — terminates the loop and declares what to send
//
// The loop runs until return_result is called or MAX_ITERATIONS is reached.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import { env } from '../env.js';
import type { DueContact } from '../db/types.js';

const execAsync = promisify(exec);
const MAX_ITERATIONS = 10;
const BASH_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 4_000;

export interface ActionResult {
  type: 'text' | 'image' | 'file';
  text?: string;
  filePath?: string;
  caption?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ActionResultItem {
  type: 'text' | 'image' | 'file';
  text?: string;
  filePath?: string;
  caption?: string;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'bash',
    description:
      'Execute a bash command on the local machine. Use this to pick files, ' +
      'generate content, call APIs, or do anything needed to fulfil the action.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'return_result',
    description:
      'Call this when you are ready to send all content. Pass an array of results — ' +
      'one entry per message to send. They will be delivered in order. ' +
      'This terminates the agent loop.',
    input_schema: {
      type: 'object' as const,
      properties: {
        results: {
          type: 'array',
          description: 'Ordered list of messages/media to send to the contact',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['text', 'image', 'file'],
                description: 'Type of content to send',
              },
              text: {
                type: 'string',
                description: 'The message text (required when type=text)',
              },
              filePath: {
                type: 'string',
                description: 'Absolute path to the file (required when type=image or file)',
              },
              caption: {
                type: 'string',
                description: 'Optional caption for an image or file',
              },
            },
            required: ['type'],
          },
        },
      },
      required: ['results'],
    },
  },
];

/**
 * Execute a plain-language action for a contact using a Claude sub-agent.
 *
 * @param contact   The due contact from the scheduler
 * @param action    Plain-language directive from config.action
 */
export async function executeAction(
  contact: DueContact,
  action: string
): Promise<ActionResult[]> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = 'claude-sonnet-4-6';

  const systemPrompt =
    `You are an action executor for a personal messaging app called MessengerOfGod. ` +
    `Your job is to carry out a plain-English action for a specific contact and decide what to send them.\n\n` +
    `RULES:\n` +
    `- Always use the bash tool to actually fetch, pick, or look up content — never fabricate or skip steps.\n` +
    `- For fetching live data (news, history, weather, etc.) use curl with appropriate public APIs.\n` +
    `- For historical events on today's date, the Wikipedia On This Day API works well:\n` +
    `  curl -s "https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/$(date +%m)/$(date +%d)"\n` +
    `- Keep text messages warm, personal, and concise (3–10 sentences max).\n` +
    `- Use type=text for formatted text — only use type=file/image when you have a real file path.\n` +
    `- Always finish by calling return_result with all content to send.`;

  const userPrompt =
    `Contact: ${contact.contact_name}\n` +
    `Relationship: ${contact.relationship}\n` +
    `Channel: ${contact.channel_type}\n` +
    `Days since last message: ${contact.days_since_last_message}\n` +
    `Notes: ${contact.notes ?? 'none'}\n\n` +
    `Action to execute: ${action}`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userPrompt },
  ];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    totalPromptTokens += response.usage.input_tokens;
    totalCompletionTokens += response.usage.output_tokens;

    // Check for return_result
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'return_result') {
        const input = block.input as { results: ActionResultItem[] };
        logger.info(
          { contact: contact.contact_name, count: input.results.length },
          'Action executor: return_result received'
        );
        return input.results.map((item) => ({
          type: item.type as 'text' | 'image' | 'file',
          text: item.text,
          filePath: item.filePath,
          caption: item.caption,
          model,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
        }));
      }
    }

    // Natural end_turn with text (Claude decided to respond directly)
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text' && textBlock.text.trim()) {
        return [{
          type: 'text',
          text: textBlock.text.trim(),
          model,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
        }];
      }
      break;
    }

    // Execute bash tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'bash') {
        const command = (block.input as { command: string }).command;
        logger.debug({ command }, 'Action executor: running bash command');

        let output: string;
        try {
          const { stdout, stderr } = await execAsync(command, {
            timeout: BASH_TIMEOUT_MS,
          });
          output = (stdout + stderr).trim() || '(no output)';
        } catch (err) {
          output = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: output.slice(0, MAX_OUTPUT_CHARS),
        });
      }
    }

    messages.push({ role: 'assistant', content: response.content });
    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
    }
  }

  // Fallback if max iterations reached without return_result
  logger.warn(
    { contact: contact.contact_name },
    'Action executor: max iterations reached, using fallback message'
  );
  return [{
    type: 'text',
    text: `Hey ${contact.contact_name}, just thinking of you! Hope you're doing well.`,
    model,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
  }];
}
