# Pre-Frontend Audit: Logical Gaps, Observability, Tokens & MCP

## 1. Unforeseen Logical Problems & Infinite Loops

### 1.1 — The "Polite Agent" Infinite Loop ⚠️ CRITICAL

**Current code** (`orchestrator.go:315`):
```go
if resp.Content == "OBJECTIVE_COMPLETE" {
```

This is an **exact string match**. An LLM will almost never return *exactly* `OBJECTIVE_COMPLETE` 
and nothing else. It will say "Based on my analysis, OBJECTIVE_COMPLETE" or "OBJECTIVE_COMPLETE. 
Here is my summary..." — and the loop continues forever until max iterations (100) or budget exhaustion.

**Fix:** Use `strings.Contains` or a regex. Better yet, ask the LLM to return a structured 
JSON signal and parBefore we begin the large-scale implementation of the on-demand MCPs, is there anything else we've already covered that's incomplete, needs reviewing, or where I have logical problems?

Or, imagining a typical user experience, are there any logical gaps or things that might not be consistent?e it. Example:
```json
{"status": "complete", "summary": "..."}  // vs
{"status": "continue", "next_action": "..."}
```

### 1.2 — No Per-Agent Iteration Limit ⚠️

The agent model now has `max_iterations`, but the orchestrator ignores it completely.
The global `maxIterations = 100` is hardcoded. Agent-level `max_iterations` from the DB
is never read.

**Fix:** The orchestrator should respect the minimum of (global budget, per-agent limit).

### 1.3 — Sequential Agent Execution = Bottleneck

Current flow: agents run **one at a time per iteration** in a fixed order.
If Agent A produces garbage, Agent B still gets it and builds on it.
There's no mechanism for Agent B to say "Agent A's output is wrong, let's retry."

**Fix (Phase 1):** After the QA agent (Lexus) runs, if it flags issues, re-run 
the flagged agents with the QA feedback before moving to the next iteration.

**Fix (Phase 2):** Add an `inter_agent_message` mechanism where agents can 
address messages to specific other agents, not just broadcast.

### 1.4 — No Conversation Memory Between Iterations ⚠️ CRITICAL

Each iteration builds a fresh `taskMsg` with just:
- The objective
- The strategy
- The iteration number
- Results from *this iteration only*

Previous iterations' outputs are completely lost. By iteration 5, the agents have 
no memory of what happened in iterations 1-4. They'll repeat work or contradict 
themselves.

**Fix:** Maintain a `conversation_history` per execution that accumulates across 
iterations. Send the last N messages as context (sliding window to stay within 
token limits).

### 1.5 — Token Budget Check Timing

Tokens are checked at the **start** of each iteration, but not between agent calls.
If Agent A uses 900K tokens and the budget is 1M, Agent B still runs and may push 
to 1.8M before the loop checks again.

**Fix:** Check `tokensUsed >= budget` after *each* agent response, not just at 
iteration start.

### 1.6 — No Error Recovery / Retry

If an agent call fails (network timeout, API error), it's logged and skipped.
But the agent is never retried. In a real scenario, a transient LLM API error 
kills that agent's contribution for the entire iteration.

**Fix:** Add retry with exponential backoff (1-2 retries max) per agent call.

### 1.7 — Race Condition: Workforce Status

Multiple executions could theoretically start for the same workforce (race between 
status check and update). The current check is:
```go
if wf.Status == models.WorkForceStatusExecuting {
    return nil, fmt.Errorf("workforce %s is already executing", workforceID)
}
```
This is a read-then-write race. Two concurrent API calls could both pass this check.

**Fix:** Use a PostgreSQL advisory lock or `UPDATE ... WHERE status != 'executing' RETURNING id`.

---

## 2. Agent Conversation Monitoring & Thought Observability

### What We Have Now
- Events table with `type`, `message`, `data` (JSONB)
- Event types: `agent_thinking`, `agent_acting`, `agent_completed`, `tool_call`, etc.
- Events streamed via WebSocket per execution
- But: **we only store the final response**, not the full prompt or reasoning chain

### What's Missing

#### 2.1 — Full Message Log (the "Transcript")

We need a `messages` table that stores the actual LLM conversation:

```sql
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id),
    agent_name VARCHAR(255) NOT NULL DEFAULT '',
    iteration INT NOT NULL DEFAULT 0,
    role VARCHAR(20) NOT NULL,  -- 'system', 'user', 'assistant', 'tool'
    content TEXT NOT NULL,
    tokens_input INT NOT NULL DEFAULT 0,
    tokens_output INT NOT NULL DEFAULT 0,
    model VARCHAR(255) NOT NULL DEFAULT '',
    provider_id UUID,
    latency_ms INT NOT NULL DEFAULT 0,
    tool_calls JSONB,           -- [{name, args, result}]
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

This lets you:
- See exactly what prompt was sent to each agent
- See exactly what the LLM returned (including reasoning)
- Track tokens per message (input vs output)
- Track latency per call
- Replay the entire conversation

#### 2.2 — Chain-of-Thought Visibility

For ReAct agents, the LLM's internal reasoning (Thought → Action → Observation) 
should be captured separately. The `TaskResponse` should include:

```go
type TaskResponse struct {
    Content    string         `json:"content"`
    Reasoning  string         `json:"reasoning,omitempty"` // NEW: internal CoT
    TokensUsed int64          `json:"tokens_used"`
    TokensIn   int64          `json:"tokens_input"`        // NEW: prompt tokens
    TokensOut  int64          `json:"tokens_output"`       // NEW: completion tokens
    ToolCalls  []ToolCallInfo `json:"tool_calls,omitempty"`
    Model      string         `json:"model"`               // NEW: actual model used
    LatencyMs  int64          `json:"latency_ms"`           // NEW
    Done       bool           `json:"done"`
}
```

#### 2.3 — Inter-Agent Message Tracking

When Agent A's output is fed to Agent B, that handoff should be an explicit 
event. Currently it's invisible — it's just string concatenation in `iterationResults`.

**Fix:** Emit an `inter_agent_message` event for each handoff with `from_agent` 
and `to_agent` fields.

---

## 3. Token Usage & Consumption Tracking

### What We Have Now
- `executions.tokens_used` — a single int64 total
- `IncrementExecutionTokens()` — adds after each agent call
- `tokensUsed` on the `TaskResponse` — but this is often 0 (many APIs don't return it)
- Budget check: `tokensUsed >= wf.BudgetTokens`

### What's Missing

#### 3.1 — Input vs Output Token Split

Most LLM providers charge differently for input (prompt) vs output (completion) tokens.
We store only the total. The OpenAI API returns:
```json
{"usage": {"prompt_tokens": 150, "completion_tokens": 50, "total_tokens": 200}}
```

We should capture all three.

#### 3.2 — Per-Agent Token Tracking

Currently all tokens are aggregated at the execution level only. We can't answer 
"Which agent is the most expensive?" without querying the messages table.

**Fix:** Add an `agent_usage` table or at minimum include agent_id in the messages 
table (proposed above).

#### 3.3 — Cost Estimation

Different providers have different pricing. We should store cost per model 
somewhere in `provider_models.config`:

```json
{"cost_per_1k_input": 0.003, "cost_per_1k_output": 0.015, "currency": "USD"}
```

Then calculate estimated cost from token counts.

#### 3.4 — OpenAI-compat Connector Doesn't Parse Tokens Properly

In `openai_compat.go`, we only read `usage.total_tokens`. We need to also read 
`prompt_tokens` and `completion_tokens`.

#### 3.5 — Dashboard Aggregation

Need API endpoints for:
- `GET /api/v1/usage/summary` — total tokens, cost, by time period
- `GET /api/v1/usage/by-agent` — tokens per agent
- `GET /api/v1/usage/by-provider` — tokens per provider
- `GET /api/v1/executions/:id/messages` — full conversation transcript

---

## 4. MCP Server Architecture — Deployable on Demand

### The Vision

Users upload an MCP server (zip, tar.gz, GitHub URL, or folder) → AitherOS 
deploys it as a running service → agents can call its tools via the MCP protocol.

### MCP Background

MCP (Model Context Protocol) servers expose tools via JSON-RPC over stdio or 
HTTP/SSE. Each MCP server provides:
- A list of tools with schemas
- A `call_tool(name, args)` endpoint

### Architecture Options

#### Option A: Docker Containers (Recommended for Production)

```
User uploads MCP server code
    ↓
Backend validates + stores in /data/mcp-servers/{id}/
    ↓
Backend generates Dockerfile if missing (detect runtime: node, python, go)
    ↓
docker build → tagged image aitheros-mcp-{id}:{version}
    ↓
docker run -d --name mcp-{id} --network aitheros-net ...
    ↓
Backend registers MCP endpoint in mcp_servers table
    ↓
Agents can now use tools from this MCP server
```

**Pros:**
- Full isolation (security-critical for arbitrary user code)
- Resource limits (CPU, memory, network)
- Clean lifecycle (start/stop/delete)
- Works with any language runtime
- Can rate-limit or restrict network access per container

**Cons:**
- Docker daemon required
- ~500ms cold start per container
- Disk usage for images

#### Option B: Process Spawning (Simpler, Less Secure)

Run MCP servers as child processes with stdio transport. No Docker needed.

```
Backend spawns: node /data/mcp-servers/{id}/index.js
    ↓
Communicates via stdin/stdout JSON-RPC
    ↓
Process killed when no longer needed
```

**Pros:** Simpler, no Docker dependency, faster startup
**Cons:** No isolation, user code runs with backend privileges, hard to limit resources

#### Option C: Hybrid (Recommended)

- **Built-in MCP servers** (web_search, filesystem, database) → run as processes 
  in the Go sidecar or Python sidecar
- **User-uploaded MCP servers** → always Docker containers (untrusted code)
- **GitHub-sourced MCP servers** → Docker containers with caching

### Proposed Data Model

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_type VARCHAR(30) NOT NULL CHECK (source_type IN (
        'upload', 'github', 'builtin'
    )),
    source_url TEXT NOT NULL DEFAULT '',        -- GitHub URL or empty
    runtime VARCHAR(30) NOT NULL DEFAULT 'auto' CHECK (runtime IN (
        'auto', 'node', 'python', 'go', 'docker'
    )),
    transport VARCHAR(20) NOT NULL DEFAULT 'stdio' CHECK (transport IN (
        'stdio', 'http', 'sse'
    )),
    container_id VARCHAR(255) NOT NULL DEFAULT '',   -- Docker container ID when running
    container_image VARCHAR(255) NOT NULL DEFAULT '', -- Docker image tag
    endpoint TEXT NOT NULL DEFAULT '',                -- HTTP endpoint when running
    status VARCHAR(20) NOT NULL DEFAULT 'inactive' CHECK (status IN (
        'inactive', 'building', 'running', 'error', 'stopped'
    )),
    tools JSONB NOT NULL DEFAULT '[]',          -- cached tool list from MCP discovery
    config JSONB NOT NULL DEFAULT '{}',         -- env vars, resource limits, etc.
    error_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which agents can use which MCP servers
CREATE TABLE IF NOT EXISTS agent_mcp_servers (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    mcp_server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, mcp_server_id)
);
```

### MCP Lifecycle Flow

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  Upload/URL  │────▶│  Validate &  │────▶│  Build Docker  │
│  (zip/git)   │     │  Store Files │     │  Image         │
└─────────────┘     └──────────────┘     └────────┬───────┘
                                                   │
                    ┌──────────────┐     ┌─────────▼───────┐
                    │  Agent calls │◀────│  Start Container │
                    │  MCP tool    │     │  + Discover Tools│
                    └──────┬───────┘     └─────────────────┘
                           │
                    ┌──────▼───────┐     ┌─────────────────┐
                    │  JSON-RPC    │────▶│  MCP Server      │
                    │  call_tool() │     │  (in container)  │
                    └──────────────┘     └─────────────────┘
```

### MCP Client in Go

The backend needs an MCP client that can:
1. Connect to an MCP server (stdio for containers, HTTP/SSE for remote)
2. Call `initialize` to get server info
3. Call `tools/list` to discover available tools
4. Call `tools/call` with tool name + arguments
5. Return results to the agent

### Agent↔MCP Integration

When the orchestrator dispatches a task to an agent:
1. Look up `agent_mcp_servers` to find which MCP servers this agent can use
2. For each MCP server, get its `tools` list
3. Merge MCP tools with the agent's built-in tools
4. Send all tool schemas to the LLM as function definitions
5. When the LLM calls a tool → route to the correct MCP server
6. Return the tool result to the LLM for the next iteration

### Dockerfile Auto-Generation

For user uploads without a Dockerfile:

```python
# Detect from package.json → Node.js
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "index.js"]
```

```python
# Detect from pyproject.toml/requirements.txt → Python
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "server.py"]
```

### Security Considerations

- Containers run with `--network=aitheros-internal` (no external access by default)
- Optional: `--network=aitheros-external` flag per MCP server (user toggles)
- CPU limit: `--cpus=1`, Memory: `--memory=512m` (configurable)
- No volume mounts to host filesystem
- Health check: container must respond to MCP `initialize` within 30s
- Auto-stop containers idle for >30 minutes (configurable)
- Image size limit: 2GB

---

## 5. Implementation Priority

| # | Item | Impact | Effort | Priority |
|---|------|--------|--------|----------|
| 1 | Fix "OBJECTIVE_COMPLETE" detection | Prevents infinite loops | Low | 🔴 NOW |
| 2 | Conversation memory (messages table) | Required for observability | Medium | 🔴 NOW |
| 3 | Token split (input/output) + per-message tracking | Required for cost tracking | Low | 🔴 NOW |
| 4 | MCP Server data model + upload endpoint | Foundation for MCP | Medium | 🔴 NOW |
| 5 | MCP Docker container lifecycle | Core MCP feature | High | 🟡 NEXT |
| 6 | MCP Client (Go JSON-RPC) | Connects agents to MCP | Medium | 🟡 NEXT |
| 7 | Inter-agent message tracking | Better observability | Low | 🟡 NEXT |
| 8 | Error retry with backoff | Resilience | Low | 🟢 LATER |
| 9 | Parallel agent execution | Performance | Medium | 🟢 LATER |
| 10 | Cost estimation dashboard | Business value | Low | 🟢 LATER |
