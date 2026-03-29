-- Migration 020: Kanban task lifecycle timestamps
ALTER TABLE kanban_tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE kanban_tasks ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;
