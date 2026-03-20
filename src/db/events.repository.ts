// ============================================================================
// events.repository.ts
// Writes Baileys connection lifecycle events to the connection_events table.
// Used exclusively by WhatsAppChannel — never throws, always fire-and-forget.
// ============================================================================

import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export type ConnectionEventType = 'connected' | 'disconnected' | 'reconnecting' | 'fatal';

/**
 * Insert a single row into connection_events.
 * Silently swallows errors so a DB hiccup never interrupts the Baileys flow.
 */
export async function logConnectionEvent(
  eventType: ConnectionEventType,
  details?: string,
  statusCode?: number,
): Promise<void> {
  const { error } = await supabase.from('connection_events').insert({
    event_type:  eventType,
    status_code: statusCode ?? null,
    details:     details ?? null,
  });

  if (error) {
    // Log but never throw — connection events are best-effort observability.
    logger.warn({ error, eventType }, 'Failed to log connection event (non-fatal)');
  }
}
