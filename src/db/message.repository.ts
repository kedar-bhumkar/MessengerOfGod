import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import type { MessageHistory, ConversationMessage, MessageStatus } from './types.js';

/** Data required to insert a new message record */
export type InsertMessage = Omit<MessageHistory, 'id' | 'created_at'>;

export const messageRepository = {
  /**
   * Insert a new message into message_history.
   * Used both for outbound messages we send and inbound messages we receive.
   */
  async create(msg: InsertMessage): Promise<MessageHistory> {
    const { data, error } = await supabase
      .from('message_history')
      .insert(msg)
      .select()
      .single();

    if (error) {
      logger.error({ error, msg }, 'Failed to insert message');
      throw error;
    }

    return data as MessageHistory;
  },

  /**
   * Fetch recent messages for a contact (both inbound and outbound),
   * ordered chronologically (oldest first) so the AI gets proper context.
   */
  async getRecentMessages(configId: string, limit = 20): Promise<ConversationMessage[]> {
    const { data, error } = await supabase
      .from('message_history')
      .select('direction, message, status, created_at')
      .eq('config_id', configId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error, configId }, 'Failed to get recent messages');
      throw error;
    }

    // Reverse to get chronological order (oldest first = natural reading order)
    return ((data ?? []) as ConversationMessage[]).reverse();
  },

  /**
   * Update the status of a previously inserted message record.
   * Used to update 'pending' → 'sent'/'delivered'/'failed' after send confirmation.
   */
  async updateStatus(
    id: string,
    status: MessageStatus,
    errorDetails?: string
  ): Promise<void> {
    const update: Partial<MessageHistory> = { status };
    if (errorDetails !== undefined) {
      update.error_details = errorDetails;
    }

    const { error } = await supabase
      .from('message_history')
      .update(update)
      .eq('id', id);

    if (error) {
      logger.error({ error, id, status }, 'Failed to update message status');
      throw error;
    }
  },
};
