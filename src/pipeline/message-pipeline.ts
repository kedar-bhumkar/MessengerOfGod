import { channelRegistry } from '../channels/channel.registry.js';
import { generateMessage } from '../ai/message-generator.js';
import { messageRepository } from '../db/message.repository.js';
import { logger } from '../utils/logger.js';
import type { DueContact } from '../db/types.js';
import type { GenerationRequest } from '../ai/prompt-builder.js';

export interface PipelineResult {
  success: boolean;
  contactName: string;
  message?: string;
  error?: string;
}

/**
 * Process a single due contact through the full message pipeline:
 *   1. Resolve the messaging channel
 *   2. Load recent conversation history
 *   3. Generate a personalized message via AI
 *   4. Send the message through the channel
 *   5. Record the outcome in message history
 */
export async function processContact(dueContact: DueContact): Promise<PipelineResult> {
  const contactLog = {
    configId: dueContact.config_id,
    contactName: dueContact.contact_name,
    channelType: dueContact.channel_type,
  };

  try {
    // Step 1: Get the channel
    const channel = channelRegistry.get(dueContact.channel_type);
    if (!channel) {
      throw new Error(`No channel registered for type: ${dueContact.channel_type}`);
    }

    // Step 2: Load recent conversation history
    const conversationHistory = await messageRepository.getRecentMessages(
      dueContact.config_id,
      20
    );

    // Step 3: Build the generation request
    const salutationOptions = dueContact.salutation_phrase
      ? dueContact.salutation_phrase.split(';').map((s) => s.trim()).filter(Boolean)
      : [];

    const generationRequest: GenerationRequest = {
      contactName: dueContact.contact_name,
      relationship: dueContact.relationship,
      salutationOptions,
      conversationHistory,
      notes: dueContact.notes,
      daysSinceLastMessage: dueContact.days_since_last_message,
    };

    // Step 4: Generate message via AI
    logger.info(contactLog, 'Generating message for contact');
    const generatedMessage = await generateMessage(generationRequest);

    // Step 5: Send via channel
    logger.info(contactLog, 'Sending message via channel');
    const sendResult = await channel.sendMessage(
      dueContact.unique_contact_id,
      generatedMessage.text
    );

    // Step 6: Record in message history
    const status = sendResult.success ? 'sent' : 'failed';
    await messageRepository.create({
      config_id: dueContact.config_id,
      message: generatedMessage.text,
      direction: 'outbound' as const,
      status,
      error_details: sendResult.error ?? null,
      ai_model_used: generatedMessage.model,
      ai_prompt_tokens: generatedMessage.promptTokens,
      ai_completion_tokens: generatedMessage.completionTokens,
    });

    if (!sendResult.success) {
      logger.warn(
        { ...contactLog, error: sendResult.error },
        'Message generated but failed to send'
      );
      return {
        success: false,
        contactName: dueContact.contact_name,
        message: generatedMessage.text,
        error: sendResult.error ?? 'Send failed with unknown error',
      };
    }

    logger.info(
      { ...contactLog, messageLength: generatedMessage.text.length },
      'Message sent successfully'
    );

    return {
      success: true,
      contactName: dueContact.contact_name,
      message: generatedMessage.text,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ ...contactLog, error: errorMessage }, 'Pipeline failed for contact');

    // Attempt to record the failure in message history
    try {
      await messageRepository.create({
        config_id: dueContact.config_id,
        message: '',
        direction: 'outbound' as const,
        status: 'failed',
        error_details: errorMessage,
        ai_model_used: null,
        ai_prompt_tokens: null,
        ai_completion_tokens: null,
      });
    } catch (recordError) {
      logger.error(
        { ...contactLog, recordError },
        'Failed to record pipeline failure in message history'
      );
    }

    return {
      success: false,
      contactName: dueContact.contact_name,
      error: errorMessage,
    };
  }
}
