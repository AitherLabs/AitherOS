-- Kanban task attachments and cross-task references
-- Run after 022_skills.sql

ALTER TABLE kanban_tasks
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS task_refs   JSONB NOT NULL DEFAULT '[]';
