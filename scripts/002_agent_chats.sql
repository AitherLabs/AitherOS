-- AitherOS Migration 002: Agent Chat History
-- Run: psql -U aitheros -d aitheros -f scripts/002_agent_chats.sql

-- ═══════════════════════════════════════════════════════════
-- Agent Chats — persistent debug/preview chat history per agent
-- Scoped by agent_id (+ user_id for future multi-tenancy)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_chats (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    role        VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
    content     TEXT NOT NULL,
    tool_calls  JSONB NOT NULL DEFAULT '[]',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_chats_agent    ON agent_chats(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_chats_user     ON agent_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_chats_created  ON agent_chats(agent_id, created_at);
