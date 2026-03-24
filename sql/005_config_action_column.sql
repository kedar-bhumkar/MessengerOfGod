-- Migration: add action column to config and update get_due_contacts()
-- The action column holds a plain-language directive describing what to send.
-- Default keeps all existing rows using the original text-generation behaviour.

-- 1. Add column
ALTER TABLE config
  ADD COLUMN action TEXT NOT NULL
  DEFAULT 'Generate a warm, natural check-in message and send it as text';

-- 2. Update get_due_contacts() to return action (must drop first to change return type)
DROP FUNCTION IF EXISTS get_due_contacts();

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
    action                  TEXT,
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
        c.action,
        latest.last_message_at,
        COALESCE(
            EXTRACT(DAY FROM (now() - latest.last_message_at))::INTEGER,
            c.frequency_days
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
          latest.last_message_at IS NULL
          OR EXTRACT(DAY FROM (now() - latest.last_message_at)) >= c.frequency_days
      );
$$;
