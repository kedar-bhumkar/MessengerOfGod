-- ============================================================================
-- MessengerOfGod: Functions, Views & Seed Data
-- File: sql/002_functions.sql
-- Description: Creates the get_due_contacts() function, the
--              contact_conversation view, and optional seed data.
-- Depends on: 001_schema.sql
-- ============================================================================

-- ============================================================================
-- 1. GET_DUE_CONTACTS() FUNCTION
-- ============================================================================
-- Returns contacts that are due for a message:
--   - active = true
--   - Never received an outbound (non-failed) message, OR
--   - Days since the last successful outbound message >= frequency_days

CREATE OR REPLACE FUNCTION get_due_contacts()
RETURNS TABLE (
    config_id               UUID,
    contact_name            TEXT,
    channel_type            channel_type,
    unique_contact_id       TEXT,
    relationship            relationship_type,
    salutation_phrase       TEXT,
    frequency_days          INTEGER,
    timezone                TEXT,
    preferred_time_start    TEXT,
    preferred_time_end      TEXT,
    notes                   TEXT,
    last_message_at         TIMESTAMPTZ,
    days_since_last_message INTEGER
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        c.id                    AS config_id,
        c.contact_name,
        c.channel_type,
        c.unique_contact_id,
        c.relationship,
        c.salutation_phrase,
        c.frequency_days,
        c.timezone,
        c.preferred_time_start,
        c.preferred_time_end,
        c.notes,
        latest.last_message_at,
        COALESCE(
            EXTRACT(DAY FROM (now() - latest.last_message_at))::INTEGER,
            c.frequency_days        -- treat never-messaged as exactly due
        ) AS days_since_last_message
    FROM config c
    LEFT JOIN LATERAL (
        SELECT MAX(mh.created_at) AS last_message_at
        FROM message_history mh
        WHERE mh.config_id = c.id
          AND mh.direction  = 'outbound'
          AND mh.status    != 'failed'
    ) latest ON true
    WHERE c.active = true
      AND (
          latest.last_message_at IS NULL                                     -- never messaged
          OR EXTRACT(DAY FROM (now() - latest.last_message_at)) >= c.frequency_days  -- due
      );
$$;

-- ============================================================================
-- 2. CONTACT_CONVERSATION VIEW
-- ============================================================================
-- Aggregates the full message history for each contact as a JSON array,
-- ordered from oldest to newest within each conversation.

CREATE OR REPLACE VIEW contact_conversation AS
SELECT
    c.id                    AS config_id,
    c.contact_name,
    c.channel_type,
    c.unique_contact_id,
    c.relationship,
    COALESCE(
        json_agg(
            json_build_object(
                'message_id',           mh.id,
                'message',              mh.message,
                'direction',            mh.direction,
                'status',               mh.status,
                'ai_model_used',        mh.ai_model_used,
                'ai_prompt_tokens',     mh.ai_prompt_tokens,
                'ai_completion_tokens', mh.ai_completion_tokens,
                'created_at',           mh.created_at
            )
            ORDER BY mh.created_at ASC
        ) FILTER (WHERE mh.id IS NOT NULL),
        '[]'::json
    ) AS conversation
FROM config c
LEFT JOIN message_history mh ON mh.config_id = c.id
GROUP BY c.id, c.contact_name, c.channel_type, c.unique_contact_id, c.relationship;

-- ============================================================================
-- 3. SEED DATA (Commented Out - Uncomment for Testing)
-- ============================================================================
-- Sample WhatsApp contacts with different relationships for local testing.
-- Uncomment the block below and run against your Supabase instance.

/*
INSERT INTO config (contact_name, channel_type, unique_contact_id, relationship, salutation_phrase, frequency_days, timezone, preferred_time_start, preferred_time_end, notes)
VALUES
    (
        'Amit Sharma',
        'whatsapp',
        '+919876543210',
        'friend',
        'Hey Amit;Bro;Amit bhai',
        3,
        'Asia/Kolkata',
        '09:00',
        '22:00',
        'College friend. Loves cricket and tech. Works at a startup in Bangalore.'
    ),
    (
        'Priya Kapoor',
        'whatsapp',
        '+919123456789',
        'relative',
        'Hi Priya;Dear Priya;Priya didi',
        7,
        'Asia/Kolkata',
        '10:00',
        '20:00',
        'Cousin sister. Recently moved to Pune. Interested in cooking and travel.'
    ),
    (
        'Rajesh Mehta',
        'whatsapp',
        '+919988776655',
        'mentor',
        'Good morning Sir;Respected Rajesh Sir;Hello Sir',
        14,
        'Asia/Kolkata',
        '09:00',
        '18:00',
        'Former manager at TCS. Very formal. Helped with career guidance. Prefers respectful tone.'
    );
*/
