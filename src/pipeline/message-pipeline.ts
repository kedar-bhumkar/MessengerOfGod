import { channelRegistry } from '../channels/channel.registry.js';
import { executeAction } from '../ai/action-executor.js';
import { messageRepository } from '../db/message.repository.js';
import { logger } from '../utils/logger.js';
import type { DueContact } from '../db/types.js';

export interface PipelineResult {
  success: boolean;
  contactName: string;
  message?: string;
  error?: string;
}

/**
 * Process a single due contact through the full message pipeline:
 *   1. Resolve the messaging channel
 *   2. Execute the contact's action via a Claude sub-agent (bash + return_result tools)
 *   3. Send the result through the channel (text, image, or file)
 *   4. Record the outcome in message history
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

    // Step 2: Execute the action via Claude sub-agent
    logger.info({ ...contactLog, action: dueContact.action }, 'Executing action for contact');
    const result = await executeAction(dueContact, dueContact.action);

    // Step 3: Send via channel
    logger.info({ ...contactLog, resultType: result.type }, 'Sending via channel');
    let sendResult;
    const messageText = result.type === 'text'
      ? (result.text ?? '')
      : (result.caption ?? '');

    if (result.type === 'image' && result.filePath) {
      sendResult = await channel.sendImage(
        dueContact.unique_contact_id,
        result.filePath,
        result.caption
      );
    } else if (result.type === 'file' && result.filePath) {
      // Fall back to sendMessage with the file path as text until file sending is implemented
      sendResult = await channel.sendMessage(
        dueContact.unique_contact_id,
        result.caption ?? result.filePath
      );
    } else {
      sendResult = await channel.sendMessage(
        dueContact.unique_contact_id,
        result.text ?? ''
      );
    }

    // Step 4: Record in message history
    const status = sendResult.success ? 'sent' : 'failed';
    await messageRepository.create({
      config_id: dueContact.config_id,
      message: result.type === 'image'
        ? `[image: ${result.filePath}] ${result.caption ?? ''}`.trim()
        : (result.text ?? ''),
      direction: 'outbound' as const,
      status,
      error_details: sendResult.error ?? null,
      ai_model_used: result.model,
      ai_prompt_tokens: result.promptTokens,
      ai_completion_tokens: result.completionTokens,
    });

    if (!sendResult.success) {
      logger.warn(
        { ...contactLog, error: sendResult.error },
        'Action executed but failed to send'
      );
      return {
        success: false,
        contactName: dueContact.contact_name,
        message: messageText,
        error: sendResult.error ?? 'Send failed with unknown error',
      };
    }

    logger.info(
      { ...contactLog, resultType: result.type },
      'Message sent successfully'
    );

    return {
      success: true,
      contactName: dueContact.contact_name,
      message: messageText,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ ...contactLog, error: errorMessage }, 'Pipeline failed for contact');

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
