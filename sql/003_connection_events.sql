-- ============================================================================
-- 003_connection_events.sql
-- Tracks every Baileys WebSocket lifecycle transition.
--
-- Answers questions like:
--   "Was WhatsApp connected all night?"
--   "How many times did it reconnect today?"
--   "When did the fatal disconnect happen that needs a QR re-scan?"
-- ============================================================================

CREATE TABLE IF NOT EXISTS connection_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT        NOT NULL,        -- 'connected' | 'disconnected' | 'reconnecting' | 'fatal'
  status_code  INTEGER,                     -- Baileys DisconnectReason code (440, 428, 401, 515, …)
  details      TEXT,                        -- Human-readable context
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast time-range queries ("show me all events from last night")
CREATE INDEX IF NOT EXISTS idx_connection_events_occurred_at
  ON connection_events (occurred_at DESC);

-- Fast filter by event type ("show me all fatal disconnects")
CREATE INDEX IF NOT EXISTS idx_connection_events_type
  ON connection_events (event_type);

-- RLS: service role can do everything; anon cannot read
ALTER TABLE connection_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON connection_events
  FOR ALL
  USING (auth.role() = 'service_role');
