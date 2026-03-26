-- Knowledge Base — vector store for agent long-term memory and RAG
-- Requires pgvector extension. Install with: apt install postgresql-16-pgvector
-- Run: psql -U aitheros -d aitheros -f scripts/009_knowledge.sql

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_entries (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workforce_id  UUID NOT NULL REFERENCES workforces(id) ON DELETE CASCADE,
    execution_id  UUID REFERENCES executions(id) ON DELETE SET NULL,
    agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
    source_type   VARCHAR(50) NOT NULL DEFAULT 'manual',
    title         TEXT NOT NULL DEFAULT '',
    content       TEXT NOT NULL,
    -- No dimension constraint: supports any embedding model.
    -- Vector index (ivfflat/hnsw) can be added later once dimensions stabilise.
    embedding     vector,
    metadata      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_workforce  ON knowledge_entries(workforce_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_agent      ON knowledge_entries(agent_id)      WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_execution  ON knowledge_entries(execution_id)  WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_source     ON knowledge_entries(source_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_created    ON knowledge_entries(created_at DESC);
