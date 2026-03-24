// ============================================================================
// Database Types
// Mirrors the schema defined in sql/001_schema.sql and sql/002_functions.sql
// ============================================================================

export type ChannelType = 'whatsapp' | 'linkedin' | 'telegram' | 'fb_messenger';

export type RelationshipType =
  | 'friend'
  | 'relative'
  | 'colleague'
  | 'acquaintance'
  | 'mentor'
  | 'business';

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export type MessageDirection = 'outbound' | 'inbound';

/** Matches the `config` table columns. */
export interface Config {
  id: string;
  contact_name: string;
  channel_type: ChannelType;
  unique_contact_id: string;
  relationship: RelationshipType;
  salutation_phrase: string;
  frequency_days: number;
  active: boolean;
  timezone: string;
  preferred_time_start: string;
  preferred_time_end: string;
  notes: string | null;
  action: string;
  created_at: string;
  updated_at: string;
}

/** Matches the `message_history` table columns. */
export interface MessageHistory {
  id: string;
  config_id: string;
  message: string;
  direction: MessageDirection;
  status: MessageStatus;
  error_details: string | null;
  ai_model_used: string | null;
  ai_prompt_tokens: number | null;
  ai_completion_tokens: number | null;
  created_at: string;
}

/** Return type of the `get_due_contacts()` RPC function. */
export interface DueContact {
  config_id: string;
  contact_name: string;
  channel_type: ChannelType;
  unique_contact_id: string;
  relationship: RelationshipType;
  salutation_phrase: string;
  frequency_days: number;
  timezone: string;
  preferred_time_start: string;
  preferred_time_end: string;
  notes: string | null;
  action: string;
  last_message_at: string | null;
  days_since_last_message: number;
}

/** Simplified message record for conversation context. */
export interface ConversationMessage {
  direction: MessageDirection;
  message: string;
  status: MessageStatus;
  created_at: string;
}
