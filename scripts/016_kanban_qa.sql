-- 016_kanban_qa.sql
-- Add QA review fields to kanban_tasks.
-- After an execution completes, the orchestrator runs a brief LLM evaluation
-- against the task's acceptance criteria and records the result here.

ALTER TABLE kanban_tasks
  ADD COLUMN IF NOT EXISTS qa_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qa_notes  TEXT         NOT NULL DEFAULT '';
