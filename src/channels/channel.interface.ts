// ============================================================================
// Channel Interface
// Defines the core contract that all messaging channel implementations
// (WhatsApp, Telegram, LinkedIn, etc.) must satisfy.
// ============================================================================

/**
 * Result returned after attempting to send a message through a channel.
 */
export interface SendResult {
  success: boolean;
  platformMessageId?: string;
  error?: string;
}

/**
 * Represents a single message in a conversation thread.
 */
export interface ConversationMessage {
  direction: 'inbound' | 'outbound';
  message: string;
  timestamp: Date;
}

/**
 * Core contract for a messaging channel.
 * Each implementation wraps a specific platform SDK (Twilio, Telegram Bot API, etc.)
 * and exposes a uniform interface for the rest of the application.
 */
export interface ChannelInterface {
  /** Unique identifier matching the channel_type enum in the database. */
  readonly channelType: string;

  /** Initialize the channel (connect to API, authenticate, etc.). */
  initialize(): Promise<void>;

  /** Send a text message to a contact identified by their platform-specific ID. */
  sendMessage(contactId: string, message: string): Promise<SendResult>;

  /** Send an image file to a contact. */
  sendImage(contactId: string, filePath: string, caption?: string): Promise<SendResult>;

  /** Check if the channel is currently connected and healthy. */
  isHealthy(): Promise<boolean>;

  /** Graceful shutdown -- release resources, close connections. */
  shutdown(): Promise<void>;
}
