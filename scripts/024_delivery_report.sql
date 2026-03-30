-- 024: Add delivery_report column to executions
-- Stores a structured JSON summary of files written and external actions taken,
-- built automatically from tool call events at execution completion.
ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS delivery_report jsonb;
