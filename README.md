# AitherOS — Autonomous AI Workforce Platform

> Orchestrate multi-agent AI teams with real-time collaboration, human-in-the-loop control, and MCP tool integration.

AitherOS is a **self-hosted AI workforce management platform**. It lets you compose teams of AI agents (a "Workforce"), assign each agent a role, a system prompt, and tool access, then run multi-step missions (an "Execution") against a shared objective. The platform handles planning, agent coordination, token budgets, human oversight, and result synthesis — all in real-time via WebSocket.

Think of it as an AI operating system for organizations: agents are employees, workforces are teams, executions are projects.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.24 · PostgreSQL 16 · Redis 7 |
| LLM Routing | LiteLLM (OpenAI-compatible proxy) |
| Frontend | Next.js 16 · Tailwind CSS v4 · shadcn/ui |
| Auth | JWT (HS256) · NextAuth.js |
| Tools | Model Context Protocol (MCP) |
| Process Manager | PM2 |

## Quick Start

### Prerequisites

- Go 1.24+
- PostgreSQL 16+
- Redis 7+
- Node.js 20+ and npm
- PM2 (`npm install -g pm2`)

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — fill in DB password, JWT secret, LLM API key

cp frontend/.env.example frontend/.env.local
# Edit frontend/.env.local — fill in NEXTAUTH_SECRET and API URL
```

### 2. Setup database

```bash
make setup-db     # creates DB, runs schema migrations
make seed         # optional: seed sample agents & workforce
```

### 3. Build & run

```bash
# Backend
make build
pm2 start ecosystem.config.js --only aitheros-backend

# Frontend
cd frontend && npm install && npm run build
pm2 start ecosystem.config.js --only aitheros-frontend

# Or run both
pm2 start ecosystem.config.js
```

### 4. Run tests

```bash
make test-unit          # unit tests (no external deps)
make test-integration   # requires PostgreSQL + Redis
make test-all
```

## Project Structure

```
AitherOS/
├── backend/
│   ├── cmd/aitherd/           # Entry point (main.go)
│   ├── internal/
│   │   ├── api/               # REST handlers + WebSocket
│   │   ├── auth/              # JWT manager + middleware
│   │   ├── config/            # Env config loader (godotenv)
│   │   ├── engine/            # LLM connector (OpenAI-compat + PicoClaw)
│   │   ├── eventbus/          # Redis pub/sub + in-process fan-out
│   │   ├── mcp/               # Model Context Protocol client + manager
│   │   ├── models/            # Domain types
│   │   ├── orchestrator/      # Multi-agent execution engine
│   │   └── store/             # PostgreSQL repositories
│   └── tests/
│       ├── unit/              # Unit tests
│       └── integration/       # Integration tests (DB + Redis)
├── frontend/
│   ├── src/app/dashboard/     # Dashboard pages (agents, workforces, executions…)
│   ├── src/components/        # Shared UI components
│   ├── src/lib/api.ts         # Typed API client
│   └── src/app/api/auth/      # NextAuth route handler
├── scripts/
│   ├── 001_init.sql           # DB schema
│   ├── setup_db.sh
│   └── seed.sh
├── .env.example               # Backend env template
├── frontend/.env.example      # Frontend env template
├── ecosystem.config.js        # PM2 config
└── Makefile
```

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/auth/register` | Register user |
| `POST` | `/api/v1/auth/login` | Login → JWT |
| `GET` | `/api/v1/auth/me` | Get current user |
| `PATCH` | `/api/v1/auth/me` | Update display name / avatar |
| `POST` | `/api/v1/providers` | Create LLM provider |
| `GET` | `/api/v1/providers` | List providers |
| `POST` | `/api/v1/agents` | Create agent |
| `GET` | `/api/v1/agents` | List agents |
| `PATCH` | `/api/v1/agents/:id` | Update agent |
| `DELETE` | `/api/v1/agents/:id` | Delete agent (cascades) |
| `POST` | `/api/v1/agents/:id/debug` | Test agent (SSE stream) |
| `POST` | `/api/v1/workforces` | Create workforce |
| `GET` | `/api/v1/workforces` | List workforces |
| `PATCH` | `/api/v1/workforces/:id` | Update workforce |
| `DELETE` | `/api/v1/workforces/:id` | Delete workforce (cascades) |
| `POST` | `/api/v1/workforces/:id/executions` | Start execution |
| `GET` | `/api/v1/executions/:execID` | Get execution |
| `POST` | `/api/v1/executions/:execID/halt` | Halt running execution |
| `POST` | `/api/v1/executions/:execID/approve` | Approve / reject plan |
| `POST` | `/api/v1/executions/:execID/intervene` | Inject human message |
| `GET` | `/api/v1/mcp/servers` | List MCP servers |
| `POST` | `/api/v1/mcp/servers` | Register MCP server |
| `GET` | `/ws/executions/:execID` | WebSocket — live events |

## Domains

| Service | Port | URL |
|---------|------|-----|
| Backend API | 8080 | `backoffice.aither.systems` |
| Frontend | 3000 | `oficina.aither.systems` |
| LiteLLM proxy | 4000 | internal |

---

## Core Concepts

Understanding these five primitives is all you need to navigate the codebase.

### Agent

An Agent is an AI persona with a fixed identity, system prompt, strategy, and tool access. Agents are **reusable** — the same agent can participate in multiple workforces.

Key fields:
- `system_prompt` — defines the agent's role, personality, and knowledge scope
- `instructions` — task-specific guidance injected alongside the system prompt
- `variables` — JSONB array of typed input fields (`text`, `paragraph`, `select`, `number`, `checkbox`) whose values are interpolated into prompts using `{{variable_name}}` syntax at runtime
- `strategy` — reasoning mode (`simple`, `function_call`, `react`) — see Agent Strategies below
- `max_iterations` — hard cap on the agent's reasoning loop per subtask
- `provider_id` — FK to `model_providers`; if null, the system default provider is used
- `tools` — list of tool names this agent can use (legacy field; MCP replaces this)
- `icon`, `color`, `avatar_url` — UI display metadata

### Workforce

A Workforce is a **named team** of agents with a shared standing objective and resource budget. It is the organizational unit — like a department.

Key fields:
- `agent_ids` — ordered list of agent UUIDs (stored in `workforce_agents` join table)
- `leader_agent_id` — the agent responsible for strategy summarization and high-level coordination
- `objective` — the standing mission of this team (e.g. "Handle all customer support escalations")
- `budget_tokens` — maximum total tokens allowed across all executions (0 = unlimited)
- `budget_time_s` — maximum wall-clock time per execution in seconds (0 = unlimited)
- `status` — mirrors the status of its active execution: `draft → planning → awaiting_approval → executing → completed/failed/halted`

### Execution

An Execution is a **single run** of a Workforce against a specific objective. Think of it as a project ticket.

Key fields:
- `objective` — the specific task for this run (can differ from the workforce's standing objective)
- `inputs` — a map of variable values passed to agents at start time
- `plan` — JSONB array of `ExecutionSubtask` nodes; the dependency graph built during the planning phase
- `status` — lifecycle: `pending → planning → awaiting_approval → running → completed/failed/halted`
- `tokens_used`, `iterations` — aggregate usage counters updated after each agent turn
- `title`, `description`, `image_url` — operator-editable metadata for display in the UI
- `result` — the final synthesized output once the execution completes

### Execution Subtask

A subtask is one node in the execution plan. Each subtask is assigned to one agent and has:
- `subtask` — natural-language description of what the agent must produce
- `depends_on` — list of subtask IDs that must complete before this one starts (DAG edges)
- `status` — `pending → running → done | blocked | needs_help`
- `output` — the agent's final response for this step

### MCP Server

A Model Context Protocol server exposes tools to agents. Tools can be anything: web search, GitHub API, database queries, file system access. Access is **per-agent per-server** — granting agent A access to server B does not grant it to agent C.

---

## Agent Strategies

The `strategy` field on an Agent controls how the LLM engine runs its reasoning loop.

| Strategy | Behaviour | Best for |
|----------|-----------|----------|
| `simple` | Single prompt → single response. No tool loop. | Summarization, translation, drafting |
| `function_call` | OpenAI-style tool calling. Engine sends tool definitions; LLM returns `tool_calls`; engine executes and feeds results back. Loop continues until no more tool calls. | Agents that need to query APIs or read data |
| `react` | Chain-of-thought: the LLM produces `Thought → Action → Observation` in plain text; the engine parses and executes actions. More transparent than function_call. | Complex reasoning, debugging, multi-step research |

Strategy is resolved inside `internal/engine/openai_compat.go` (`OpenAICompatConnector`). The engine adapter handles the loop; the orchestrator just calls `Run()` and waits for the result.

---

## Execution Pipeline

This is the heart of AitherOS. Trace a full execution from API call to result:

```
POST /api/v1/workforces/:id/executions
        │
        ▼
Orchestrator.StartExecution()
  ├── Create Execution record (status: pending → planning)
  ├── Store cancellable context in activeExecs map
  └── go runPlanning()          ← async goroutine
          │
          ▼
  runPlanning()
  ├── Load all agents in the workforce
  ├── For each agent → ask "what's your strategy for this objective?"
  │     (runAgentTask with a strategy-formulation prompt)
  ├── Leader agent synthesizes all responses into a final Plan JSON
  │     (array of ExecutionSubtask with depends_on DAG edges)
  ├── Parse + persist the plan to executions.plan (JSONB)
  ├── Set status: awaiting_approval
  └── Publish event: execution.plan_ready
          │
          ▼ (operator reviews plan in UI and clicks Approve or Reject)
  POST /api/v1/executions/:id/approve
  └── Orchestrator.ApproveExecution()
        ├── If rejected: status → halted, done
        └── If approved: status → running
                │
                ▼
          go runExecutionLoop()
          ├── Connect MCP servers for this workforce
          ├── Build topological order of subtasks (respecting depends_on)
          ├── For each subtask in order:
          │     ├── Resolve agent's connector + model
          │     ├── Resolve agent's allowed MCP tools
          │     ├── Collect previous subtask outputs as context
          │     ├── Check intervention channel for human messages
          │     ├── runAgentTask() → LLM call(s) via engine strategy loop
          │     │     ├── Persist every message to messages table
          │     │     ├── Execute any tool_calls via MCP manager
          │     │     └── Return agentResult (content, tokens, completion signal)
          │     ├── Update subtask status in plan (running → done/blocked/needs_help)
          │     └── Publish event: agent_response / agent_thinking / tool_call
          ├── Check token + time budgets after each subtask
          ├── Check for OBJECTIVE_COMPLETE signal in agent output
          └── Persist final result, update status → completed/failed/halted
```

### Human-in-the-Loop

Two mechanisms allow humans to influence a running execution:

1. **Plan approval** — After planning, the execution pauses at `awaiting_approval`. The operator sees the full plan in the UI, can review it, and either approves (continues) or rejects (halts).

2. **Intervention** — While running, the operator can type a message via the chat input. This is sent to `POST /api/v1/executions/:id/intervene`, which pushes the message onto an internal channel. Before the next agent subtask, the orchestrator drains this channel and prepends the human message as a `user`-role turn in the agent's conversation.

### Completion Detection

Each agent is instructed to end its response with a code-fenced JSON block when it believes the objective is fully satisfied:

```json
{"status": "complete", "summary": "I have finished the task."}
```

The orchestrator's `extractCompletionSignal()` function looks specifically for this code-fenced block. Plain text mentions of the word "complete" are intentionally ignored to avoid false positives.

Agents can also signal `"needs_help"` (pauses the subtask, waits for intervention) or `"blocked"` (marks the subtask as blocked and moves on).

---

## Database Schema

All migrations live in `scripts/`. Run them in order against your PostgreSQL instance.

| Script | Description |
|--------|-------------|
| `001_init.sql` | Core tables: users, model_providers, provider_models, agents, workforces, workforce_agents, executions, messages, events |
| `002_agent_chats.sql` | Agent chat sessions (debug playground) |
| `003_execution_plan.sql` | Adds `plan`, `title`, `description`, `image_url`, `result` columns to executions; adds `avatar_url` to agents/workforces |
| `004_media.sql` | MCP tables: `mcp_servers`, `mcp_server_tools`, `workforce_mcp_servers`, `agent_mcp_permissions`; knowledge base tables; activity events; approvals; leader_agent_id on workforces |

### Key relationships

```
users
  │
model_providers ──< provider_models
  │
agents ──< workforce_agents >── workforces
                                    │
                             workforce_mcp_servers >── mcp_servers
                                    │                       │
                             agent_mcp_permissions ──< mcp_server_tools
                                    │
                                executions
                                    │
                              ┌─────┴──────┐
                           messages      events
```

---

## Real-Time System

AitherOS uses two overlapping real-time layers:

### EventBus (`internal/eventbus/`)

An in-process pub/sub backed by Redis. Every execution event (agent thinking, tool call, agent response, status change) is published here. The `EventBus` fans out to:
- WebSocket connections watching that execution
- The persistent `events` DB table (for replay after reconnect)

Event types defined in `internal/models/event.go`:
`agent_thinking`, `agent_response`, `tool_call`, `tool_result`, `execution_started`, `execution_completed`, `execution_failed`, `execution_halted`, `plan_ready`, `human_intervention`, `system`

### WebSocket (`internal/api/websocket.go`)

- Endpoint: `GET /ws/executions/:execID?token=<jwt>`
- Authenticates via `?token=` query param or `Authorization: Bearer` header
- On connect: replays the last N persisted events from the DB so the client gets history
- On new events: streams JSON event objects in real-time
- Frontend subscribes on the execution detail page and feeds events into the live flow panel

---

## Auth System

Authentication uses JWT (HS256). The flow:

1. Client POSTs credentials to `/api/v1/auth/login` → receives a JWT token
2. All subsequent requests include `Authorization: Bearer <token>`
3. The JWT middleware (`internal/auth/middleware.go`) validates the token and sets `userID` in the request context
4. The frontend uses **NextAuth.js** with the `CredentialsProvider` strategy to wrap this — it stores the JWT in the NextAuth session so the browser has access to it client-side

**Current mode:** `OptionalMiddleware` is used on all routes (beta mode). This means requests without a token are still allowed through. To enforce authentication strictly, swap to `auth.Middleware()` in `internal/api/router.go`.

User roles: `admin`, `user`, `viewer` (stored in the `users` table, included in the JWT payload).

Profile updates (display name, avatar photo) are persisted to the `users` table via `PATCH /api/v1/auth/me`. The frontend sidebar listens for a `profileUpdated` browser custom event and re-fetches the profile immediately after save.

---

## MCP Tool Integration

The Model Context Protocol integration is in `internal/mcp/`.

### Setup flow

1. Admin creates an MCP server record (command, args, env vars, or HTTP URL) via the `/dashboard/mcp` page
2. Click **Discover Tools** → backend spawns/connects the MCP server, calls `tools/list`, caches results in `mcp_server_tools`
3. In the Workforce detail page, **attach** the server to a workforce
4. **Grant** tool access to specific agents (Grant All = empty tool_name row = all tools allowed)

### Runtime flow

During `runExecutionLoop()`:
1. `mcpManager.ConnectWorkforceServers()` — connects all servers attached to the workforce; builds an O(1) `toolIndex` map (`toolName → serverID`)
2. `mcpManager.ResolveAgentToolDefs()` — for each agent, looks up its `agent_mcp_permissions` and returns the matching `MCPToolDefinition` structs
3. Tool definitions are passed to the engine connector as `TaskRequest.ToolDefs`
4. The engine sends them to the LLM as OpenAI function definitions
5. When the LLM responds with a `tool_call`, `mcpManager.ExecuteToolCall()` looks up the server via the `toolIndex` and routes the call — zero DB queries per tool call

Transport types supported: `stdio` (subprocess JSON-RPC), `http` (SSE/HTTP).

---

## Frontend Architecture

The frontend is a Next.js 16 App Router application (`frontend/src/`).

### Key pages

| Route | File | Purpose |
|-------|------|---------|
| `/dashboard/overview` | `overview/page.tsx` | System stats, recent executions, quick actions |
| `/dashboard/agents` | `agents/page.tsx` | Agent list; create/edit/delete agents with full form |
| `/dashboard/agents/[id]` | (detail page) | Agent detail, debug chat playground, variable testing |
| `/dashboard/workforces` | `workforces/page.tsx` | Workforce cards with team structure diagrams |
| `/dashboard/workforces/[id]` | `workforces/[id]/page.tsx` | Workforce detail: agents, MCP tools, knowledge base, executions, approvals |
| `/dashboard/executions` | `executions/page.tsx` | Execution list with status, tokens, agent avatars |
| `/dashboard/executions/[id]` | `executions/[id]/page.tsx` | Mission Control: 3-column layout with agent call grid, live chat stream, WebSocket events |
| `/dashboard/mcp` | `mcp/page.tsx` | MCP server management: create, discover tools, enable/disable |
| `/dashboard/providers` | `providers/page.tsx` | LLM provider management |
| `/dashboard/activity` | `activity/page.tsx` | Global activity feed |
| `/dashboard/settings/profile` | `settings/profile/page.tsx` | User profile: display name, avatar upload |

### Typed API client

All backend communication goes through `src/lib/api.ts` — a single typed client class with methods for every resource. **Never call `fetch()` directly in pages** — always add a method to this client. The client handles base URL resolution, auth token injection via `api.setToken()`, and response unwrapping.

### Sidebar

`src/components/layout/app-sidebar.tsx` — the persistent left navigation. It:
- Fetches the current user profile via `api.me()` on mount and on `profileUpdated` events
- Computes the operator's XP level from agent/workforce/MCP counts and renders the XP progress bar (hidden when collapsed to icon mode)
- Shows the user's avatar photo and display name in the footer user menu

### Entity Avatar system

`src/components/entity-avatar.tsx` — renders agent/workforce avatars. Supports:
- Custom uploaded image (`avatar_url`) — resolved to absolute URL if it starts with `/uploads/`
- Emoji icon with color background (`icon` + `color`)
- Initials fallback

`EntityAvatarStack` renders an overlapping row of avatars (used in execution list cards).

---

## Codebase Navigation Guide

### "Where do I find...?"

| Task | Location |
|------|----------|
| Add a new API endpoint | `backend/internal/api/` → add handler, then register in `router.go` |
| Add a new DB field | Add to model in `models/`, update SQL in `store/`, add a migration script in `scripts/` |
| Change how agents reason | `backend/internal/engine/openai_compat.go` — `runSimple()`, `runFunctionCall()`, `runReAct()` |
| Change the planning prompt | `backend/internal/orchestrator/orchestrator.go` — `summarizeStrategy()` or `buildPlanPrompt()` |
| Add a new event type | `backend/internal/models/event.go` → add constant; frontend `executions/[id]/page.tsx` → add to `eventTypeConfig` |
| Add a frontend page | `frontend/src/app/dashboard/[name]/page.tsx` + add nav entry in `src/config/nav-config.ts` |
| Add a new API client method | `frontend/src/lib/api.ts` → add method + interface |
| Change sidebar navigation | `frontend/src/config/nav-config.ts` |
| Change agent avatar rendering | `frontend/src/components/entity-avatar.tsx` |
| Change the execution detail layout | `frontend/src/app/dashboard/executions/[id]/page.tsx` |

### Key conventions

- **Backend responses** always use `api.Success(w, data)` or `api.Error(w, status, message)` from `internal/api/response.go` — never write raw JSON
- **DB scanning** uses `sqlx` with struct tags (`db:"column_name"`) — match field names exactly
- **JSONB fields** (variables, plan, inputs, tool_calls) are scanned via custom `Scan()` methods using `json.Unmarshal`
- **Events** are published via `eventBus.Publish()` (per-execution) or `eventBus.PublishSystem()` (system-level messages)
- **Frontend state** — pages are `'use client'` components that fetch data in `useEffect` with `session.accessToken`; no server components in the dashboard
- **Prompt interpolation** — `{{variable_name}}` syntax, resolved in `internal/engine/template.go`
