-- 004_media.sql: Avatar/image support for agents, workforces, and executions.
-- Also adds title + description to executions for easier identification.

ALTER TABLE agents     ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';
ALTER TABLE workforces ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';

ALTER TABLE executions ADD COLUMN IF NOT EXISTS title       TEXT NOT NULL DEFAULT '';
ALTER TABLE executions ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE executions ADD COLUMN IF NOT EXISTS image_url   TEXT NOT NULL DEFAULT '';
