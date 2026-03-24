-- ============================================================================
-- MessengerOfGod: Schema Definition
-- File: sql/001_schema.sql
-- Description: Creates enums, tables, indexes, RLS policies, and triggers
--              for the MessengerOfGod Supabase database.
-- ============================================================================

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

CREATE TYPE channel_type AS ENUM (
    'whatsapp',
    'linkedin',
    'telegram',
    'fb_messenger'
);

CREATE TYPE relationship_type AS ENUM (
    'friend',
    'relative',
    'colleague',
    'acquaintance',
    'mentor',
    'business'
);

CREATE TYPE message_status AS ENUM (
    'pending',
    'sent',
    'delivered',
    'read',
    'failed'
);

-- ============================================================================
-- 2. CONFIG TABLE
-- ============================================================================

CREATE TABLE config (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_name        TEXT            NOT NULL,
    channel_type        channel_type    NOT NULL,
    unique_contact_id   TEXT            NOT NULL,       -- phone in E.164, username, etc.
    relationship        relationship_type NOT NULL,
    salutation_phrase   TEXT            NOT NULL,       -- semicolon-separated phrases
    frequency_days      INTEGER         NOT NULL CHECK (frequency_days > 0),
    active              BOOLEAN         NOT NULL DEFAULT true,
    timezone            TEXT            NOT NULL DEFAULT 'Asia/Kolkata',
    preferred_time_start TEXT           DEFAULT '09:00',
    preferred_time_end  TEXT            DEFAULT '21:00',
    notes               TEXT,                           -- extra context about the person
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_channel_contact UNIQUE (unique_contact_id, active, channel_type)
);

-- Index for quick lookup of active contacts by channel
CREATE INDEX idx_config_active_channel ON config (active, channel_type);

-- ============================================================================
-- 3. MESSAGE_HISTORY TABLE
-- ============================================================================

CREATE TABLE message_history (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id               UUID            NOT NULL REFERENCES config(id) ON DELETE CASCADE,
    message                 TEXT            NOT NULL,
    direction               TEXT            NOT NULL DEFAULT 'outbound'
                                            CHECK (direction IN ('outbound', 'inbound')),
    status                  message_status  NOT NULL DEFAULT 'pending',
    error_details           TEXT,
    ai_model_used           TEXT,
    ai_prompt_tokens        INTEGER,
    ai_completion_tokens    INTEGER,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Index for fetching conversation history per contact, newest first
CREATE INDEX idx_message_history_config_created
    ON message_history (config_id, created_at DESC);

-- Index for querying messages by status (e.g. pending messages to send)
CREATE INDEX idx_message_history_status
    ON message_history (status);

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_history ENABLE ROW LEVEL SECURITY;

-- Service role has full access to config
CREATE POLICY "Service role full access on config"
    ON config
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Service role has full access to message_history
CREATE POLICY "Service role full access on message_history"
    ON message_history
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 5. UPDATED_AT TRIGGER
-- ============================================================================

-- Generic trigger function to auto-update the updated_at column
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to the config table
CREATE TRIGGER trg_config_updated_at
    BEFORE UPDATE ON config
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
