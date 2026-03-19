import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import type { DueContact } from './types.js';

export interface ConfigRow {
  id: string;
  contact_name: string;
  channel_type: string;
  unique_contact_id: string;
  relationship: string;
  salutation_phrase: string;
  frequency_days: number;
  active: boolean;
  timezone: string;
  preferred_time_start: string;
  preferred_time_end: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const configRepository = {
  async findByChannelAndContact(
    channelType: string,
    uniqueContactId: string,
  ): Promise<ConfigRow | null> {
    const { data, error } = await supabase
      .from('config')
      .select('*')
      .eq('channel_type', channelType)
      .eq('unique_contact_id', uniqueContactId)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      logger.error({ error, channelType, uniqueContactId }, 'Failed to query config');
      throw error;
    }

    return data;
  },

  async getAllActiveContacts(): Promise<ConfigRow[]> {
    const { data, error } = await supabase
      .from('config')
      .select('*')
      .eq('active', true);

    if (error) {
      logger.error({ error }, 'Failed to get active contacts');
      throw error;
    }

    return data ?? [];
  },

  async getDueContacts(): Promise<DueContact[]> {
    const { data, error } = await supabase.rpc('get_due_contacts');

    if (error) {
      logger.error({ error }, 'Failed to get due contacts');
      throw error;
    }

    return data ?? [];
  },
};
