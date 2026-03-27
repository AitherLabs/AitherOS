-- AitherOS Database Initialization
-- Run: psql -U aitheros -d aitheros -f scripts/001_init.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════
-- Users — authentication and account management
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(255) NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- Model Providers — configurable LLM backends
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS model_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    provider_type VARCHAR(50) NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    is_default BOOLEAN NOT NULL DEFAULT false,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
    model_name VARCHAR(255) NOT NULL,
    model_type VARCHAR(30) NOT NULL DEFAULT 'llm' CHECK (model_type IN ('llm', 'embedding', 'rerank', 'tts', 'stt')),
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider_id, model_name, model_type)
);

-- ═══════════════════════════════════════════════════════════
-- Agents — AI agent definitions with variables & strategy
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    engine_type VARCHAR(50) NOT NULL DEFAULT 'picoclaw',
    engine_config JSONB NOT NULL DEFAULT '{}',
    tools TEXT[] NOT NULL DEFAULT '{}',
    model VARCHAR(255) NOT NULL,
    provider_id UUID REFERENCES model_providers(id) ON DELETE SET NULL,
    variables JSONB NOT NULL DEFAULT '[]',
    strategy VARCHAR(30) NOT NULL DEFAULT 'simple' CHECK (strategy IN ('simple', 'function_call', 'react')),
    max_iterations INT NOT NULL DEFAULT 10,
    icon VARCHAR(255) NOT NULL DEFAULT '',
    color VARCHAR(20) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WorkForces table
CREATE TABLE IF NOT EXISTS workforces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    objective TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planning', 'awaiting_approval', 'executing', 'completed', 'failed', 'halted')),
    budget_tokens BIGINT NOT NULL DEFAULT 0,
    budget_time_s BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WorkForce-Agent join table
CREATE TABLE IF NOT EXISTS workforce_agents (
    workforce_id UUID NOT NULL REFERENCES workforces(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role_in_workforce VARCHAR(100) NOT NULL DEFAULT 'member',
    PRIMARY KEY (workforce_id, agent_id)
);

-- Executions table
CREATE TABLE IF NOT EXISTS executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workforce_id UUID NOT NULL REFERENCES workforces(id) ON DELETE CASCADE,
    objective TEXT NOT NULL,
    strategy TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'approved', 'running', 'completed', 'failed', 'halted')),
    inputs JSONB NOT NULL DEFAULT '{}',
    tokens_used BIGINT NOT NULL DEFAULT 0,
    iterations INT NOT NULL DEFAULT 0,
    result TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Messages table (full LLM conversation transcript for observability)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    agent_name VARCHAR(255) NOT NULL DEFAULT '',
    iteration INT NOT NULL DEFAULT 0,
    role VARCHAR(20) NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    tokens_input INT NOT NULL DEFAULT 0,
    tokens_output INT NOT NULL DEFAULT 0,
    model VARCHAR(255) NOT NULL DEFAULT '',
    provider_id UUID REFERENCES model_providers(id) ON DELETE SET NULL,
    latency_ms INT NOT NULL DEFAULT 0,
    tool_calls JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Events table (persistent log of all events)
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    agent_id UUID,
    agent_name VARCHAR(255) NOT NULL DEFAULT '',
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_providers_type ON model_providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_providers_default ON model_providers(is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_provider ON agents(provider_id);
CREATE INDEX IF NOT EXISTS idx_workforces_status ON workforces(status);
CREATE INDEX IF NOT EXISTS idx_executions_workforce ON executions(workforce_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_messages_execution ON messages(execution_id);
CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_events_execution ON events(execution_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
