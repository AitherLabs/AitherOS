-- Migration 005: Post-execution Q&A
-- Stores Q&A pairs for finished executions, asked against the full agent transcript.

CREATE TABLE IF NOT EXISTS execution_qa (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID        NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    question     TEXT        NOT NULL,
    answer       TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_qa_execution_id ON execution_qa(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_qa_created_at   ON execution_qa(execution_id, created_at ASC);
