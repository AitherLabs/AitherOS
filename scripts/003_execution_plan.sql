-- AitherOS Migration 003: Structured Execution Plan
-- Run: PGPASSWORD=... psql -h 127.0.0.1 -U aitheros -d aitheros -f scripts/003_execution_plan.sql

-- Add structured plan column to executions (stores subtasks with depends_on graph)
ALTER TABLE executions ADD COLUMN IF NOT EXISTS plan JSONB NOT NULL DEFAULT '[]'::jsonb;
