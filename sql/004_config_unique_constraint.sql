-- Migration: change config unique constraint to include active column
-- Old: (channel_type, unique_contact_id)
-- New: (unique_contact_id, active, channel_type)

ALTER TABLE config
  DROP CONSTRAINT uq_channel_contact;

ALTER TABLE config
  ADD CONSTRAINT uq_channel_contact
  UNIQUE (unique_contact_id, active, channel_type);
