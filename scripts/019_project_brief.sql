-- Migration 019: Project Brief (living state document per project)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief_updated_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief_interval_m INT NOT NULL DEFAULT 0;
