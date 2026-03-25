# AitherOS — Autonomous AI Workforce Platform

> Orchestrate multi-agent AI teams with real-time collaboration, vector knowledge bases, human-in-the-loop control, and MCP tool integration.

AitherOS is a **self-hosted AI workforce management platform**. It lets you compose teams of AI agents (a "Workforce"), assign each agent a role, a system prompt, and tool access, then run multi-step missions (an "Execution") against a shared objective. The platform handles planning, agent coordination, token budgets, human oversight, and result synthesis — all in real-time via WebSocket.

Think of it as an AI operating system for organizations: agents are employees, workforces are teams, executions are projects.

---

## What's New

### Multi-Agent Collaboration Phases (P1 / P2 / P3)

Every execution now goes through three distinct collaboration phases before, during, and after the work itself:

| Phase | When | What happens |
|-------|------|--------------|
| **P1 — Team Discussion** | Before execution starts | All agents discuss the objective, each contributing their perspective. The leader synthesizes their input into a structured execution plan. |
| **P2 — Peer Consultation** | Mid-execution, per-subtask | Any agent can pause and ask another agent a question (`ask_peer` signal). The consulted agent responds in real time. Up to 3 rounds per subtask. |
| **P3 — Post-Execution Review** | After all subtasks complete | The leader agent reviews all subtask outputs, produces a verdict (`review_passed` / `review_needs_revision`), with highlights and issues. Advisory only — execution always completes. |

All three phase types are displayed in the **Agent Interactions Panel** on the execution page (collapsible, left column, always visible).

### Knowledge Base with Vector RAG

Each workforce has a persistent vector knowledge base backed by PostgreSQL + `pgvector`. It is embedded using the same OpenAI-compatible API as the LLM (configurable via `EMBEDDING_MODEL` env var, default `text-embedding-3-small`).

**Auto-ingestion:**
- Mid-execution: every substantial agent response is embedded in real time (`IngestSingleMessage` — async goroutine, zero latency)
- Post-execution: the final result and all significant agent messages are embedded in a background goroutine
- Agent chat: every assistant reply ≥ 100 chars is embedded into the agent's home workforce KB

**RAG in agent prompts:**
- Before each subtask, `RetrieveRelevantForAgent` fetches the top-3 most relevant past memories for that specific agent across all executions. These are injected as `## Your Long-Term Memory` in the agent's context.
- Similarity threshold: 0.3 (cosine). Results formatted as `[Title | XX% match] content`.

**Manual entries:**
- Users can add, browse, search, and delete KB entries via `/dashboard/workforces/[id]/knowledge`

### Pre-flight Check System

Before launching an execution, the system validates the workforce configuration without side effects:

| Check | What is validated |
|-------|------------------|
| Workforce | Can be loaded from DB |
| Agents | At least one agent is configured |
| Leader agent | Set if workforce has >1 agent (required for discussion + review) |
| Agent models | Every agent resolves a valid LLM provider/model |
| Active execution | No execution currently running for this workforce |

The Launch Execution dialog auto-runs preflight when opened. A "Re-run" button allows re-validation after making changes. The Launch button is disabled if any check fails.

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

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/auth/register` | Register user |
| `POST` | `/api/v1/auth/login` | Login → JWT |
| `GET` | `/api/v1/auth/me` | Get current user |
| `PATCH` | `/api/v1/auth/me` | Update display name / avatar |

### Agents & Providers
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/providers` | Create LLM provider |
| `GET` | `/api/v1/providers` | List providers |
| `PATCH` | `/api/v1/providers/:id` | Update provider |
| `DELETE` | `/api/v1/providers/:id` | Delete provider |
| `POST` | `/api/v1/agents` | Create agent |
| `GET` | `/api/v1/agents` | List agents |
| `PATCH` | `/api/v1/agents/:id` | Update agent |
| `DELETE` | `/api/v1/agents/:id` | Delete agent (cascades) |
| `POST` | `/api/v1/agents/:id/debug` | Test agent (SSE stream or blocking) |
| `GET` | `/api/v1/agents/:id/chats` | List agent chat history |
| `POST` | `/api/v1/agents/:id/chats` | Append chat message (auto-ingests to KB) |
| `DELETE` | `/api/v1/agents/:id/chats` | Clear chat history |

### Workforces & Executions
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/workforces` | Create workforce |
| `GET` | `/api/v1/workforces` | List workforces |
| `PATCH` | `/api/v1/workforces/:id` | Update workforce |
| `DELETE` | `/api/v1/workforces/:id` | Delete workforce (cascades) |
| `GET` | `/api/v1/workforces/:id/preflight` | Pre-flight validation (no side effects) |
| `POST` | `/api/v1/workforces/:id/executions` | Start execution |
| `GET` | `/api/v1/executions` | List executions |
| `GET` | `/api/v1/executions/:execID` | Get execution |
| `DELETE` | `/api/v1/executions/:execID` | Delete execution |
| `POST` | `/api/v1/executions/:execID/halt` | Halt running execution |
| `POST` | `/api/v1/executions/:execID/resume` | Resume halted execution |
| `POST` | `/api/v1/executions/:execID/approve` | Approve / reject plan |
| `POST` | `/api/v1/executions/:execID/intervene` | Inject human message mid-execution |
| `GET` | `/api/v1/executions/:execID/discussion` | P1 discussion messages |
| `GET` | `/api/v1/executions/:execID/review` | P3 review messages |

### Knowledge Base
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/workforces/:id/knowledge` | List KB entries |
| `POST` | `/api/v1/workforces/:id/knowledge` | Create manual KB entry (auto-embeds) |
| `POST` | `/api/v1/workforces/:id/knowledge/search` | Semantic vector search |
| `GET` | `/api/v1/workforces/:id/knowledge/count` | Entry count |
| `DELETE` | `/api/v1/workforces/:id/knowledge/:entryID` | Delete entry |

### MCP Tools
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/mcp/servers` | List MCP servers |
| `POST` | `/api/v1/mcp/servers` | Register MCP server |
| `PATCH` | `/api/v1/mcp/servers/:id` | Update server |
| `DELETE` | `/api/v1/mcp/servers/:id` | Delete server |
| `GET` | `/api/v1/mcp/servers/:id/tools` | List cached tool definitions |
| `POST` | `/api/v1/mcp/servers/:id/discover` | Connect and refresh tool list |
| `GET` | `/api/v1/workforces/:id/mcp` | List servers attached to workforce |
| `POST` | `/api/v1/workforces/:id/mcp` | Attach server to workforce |
| `DELETE` | `/api/v1/workforces/:id/mcp/:serverID` | Detach server |
| `POST` | `/api/v1/mcp/agent-tools` | Grant tool access to agent |
| `DELETE` | `/api/v1/mcp/agent-tools/:agentID/:serverID` | Revoke tool access |

### Activity & Approvals
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/activity` | Global activity feed |
| `GET` | `/api/v1/workforces/:id/activity` | Workforce activity feed |
| `GET` | `/api/v1/workforces/:id/approvals` | List approvals |
| `POST` | `/api/v1/approvals/:id/resolve` | Resolve approval (approve/reject) |

### Real-time
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ws/executions/:execID` | WebSocket — live execution events |

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
  ├── Run pre-flight validation (workforce, agents, models, active exec check)
  ├── Create Execution record (status: pending → planning)
  ├── Store cancellable context in activeExecs map
  └── go runPlanning()          ← async goroutine
          │
          ▼
  ── P1: TEAM DISCUSSION ──────────────────────────────────────────
  runDiscussion()  [multi-agent only; single-agent skips to simple plan]
  ├── Each non-leader agent contributes 1 turn (perspective on objective)
  ├── Leader agent synthesizes all contributions into a Plan JSON
  │     (array of ExecutionSubtask with depends_on DAG edges, max 6 turns)
  ├── Messages stored with phase='discussion' (excluded from agent context later)
  ├── Publishes: discussion_started / discussion_turn / discussion_consensus events
  └── Falls back to buildSimplePlan() if JSON parse fails
          │
          ▼
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
  ── EXECUTION LOOP ───────────────────────────────────────────────
          go runExecutionLoop()
          ├── Connect MCP servers for this workforce
          ├── Build topological order of subtasks (respecting depends_on)
          ├── For each subtask in order:
          │     ├── Resolve agent's connector + model
          │     ├── Resolve agent's allowed MCP tools
          │     ├── Retrieve agent's long-term memory from KB (RAG, top-3 matches)
          │     ├── Collect previous subtask outputs as context
          │     ├── Check intervention channel for human messages
          │     ├── runAgentTask() → LLM call(s) via engine strategy loop
          │     │     ├── Persist every message to messages table
          │     │     ├── Execute any tool_calls via MCP manager
          │     │     │
          │     │     ├── ── P2: PEER CONSULTATION (mid-subtask) ──────────
          │     │     │   ├── Detect ask_peer signal in response
          │     │     │   │     {"status":"ask_peer","peer":"Name","question":"..."}
          │     │     │   ├── Call runPeerConsultation() → 1 LLM call to peer agent
          │     │     │   ├── Store Q+A with phase='peer_consultation'
          │     │     │   ├── Inject peer answer back into caller's conversation
          │     │     │   └── Re-submit (max 3 rounds per subtask)
          │     │     │
          │     │     ├── Embed response into KB in real time (IngestSingleMessage)
          │     │     └── Return agentResult (content, tokens, completion signal)
          │     ├── Update subtask status in plan (running → done/blocked/needs_help)
          │     └── Publish event: agent_response / agent_thinking / tool_call
          ├── Check token + time budgets after each subtask
          │
          ├── ── P3: POST-EXECUTION REVIEW ────────────────────────────────
          │   ├── [multi-agent with leader only]
          │   ├── runReview() → leader LLM reviews all subtask outputs
          │   ├── Produces JSON: {status, summary, highlights[], issues[]}
          │   ├── Messages stored with phase='review'
          │   └── Publishes: review_started / review_complete events
          │
          └── completeExecution()
                ├── Persist final result, update status → completed
                └── Background: IngestExecutionResult + IngestAgentMessages → KB
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
| `/dashboard/agents` | `agents/page.tsx` | Agent list; create/edit/delete agents (3-step wizard) |
| `/dashboard/agents/[id]` | `agents/[id]/page.tsx` | Agent detail, debug chat playground, variable testing |
| `/dashboard/workforces` | `workforces/page.tsx` | Workforce cards with team structure diagrams (3-step wizard) |
| `/dashboard/workforces/[id]` | `workforces/[id]/page.tsx` | Workforce detail: agents, MCP tools, knowledge base, executions, approvals, launch with preflight |
| `/dashboard/workforces/[id]/knowledge` | `workforces/[id]/knowledge/page.tsx` | Knowledge Base: browse entries, semantic search, manual add, delete, source type filter |
| `/dashboard/executions` | `executions/page.tsx` | Execution list with status, tokens, agent avatars |
| `/dashboard/executions/[id]` | `executions/[id]/page.tsx` | Mission Control: agent call grid, live chat stream, WebSocket events; Agent Interactions Panel (P1/P2/P3); Review Panel |
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

---

## Environment Variables Reference

### Backend (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SERVER_HOST` | No | Bind address (default `0.0.0.0`) |
| `SERVER_PORT` | No | HTTP port (default `8080`) |
| `ENVIRONMENT` | No | `development` or `production` |
| `DATABASE_URL` | Yes | Full PostgreSQL DSN |
| `POSTGRES_HOST` | Yes | DB host (used if DATABASE_URL not set) |
| `POSTGRES_PORT` | No | DB port (default `5432`) |
| `POSTGRES_USER` | Yes | DB username |
| `POSTGRES_PASSWORD` | Yes | DB password |
| `POSTGRES_DB` | Yes | DB name |
| `REDIS_URL` | Yes | Full Redis URL (e.g. `redis://127.0.0.1:6379/0`) |
| `JWT_SECRET` | Yes | HS256 signing key — generate with `openssl rand -hex 32` |
| `JWT_EXPIRY` | No | Token lifetime (default `24h`) |
| `LLM_API_BASE` | Yes | LiteLLM (or OpenAI-compatible) base URL, e.g. `http://127.0.0.1:4000/v1` |
| `LLM_API_KEY` | Yes | API key for the LLM proxy |
| `LLM_MODEL` | Yes | Default model name if an agent has no provider set (e.g. `gpt-4o-mini`) |
| `PICOCLAW_URL` | No | PicoClaw agent engine URL (if using PicoClaw adapter) |
| `PICOCLAW_TIMEOUT` | No | Request timeout to PicoClaw (default `120s`) |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins, e.g. `http://localhost:3000,https://your-domain.com` |
| `ENCRYPTION_KEY` | Yes | AES key for encrypting sensitive provider credentials — generate with `openssl rand -base64 32` |
| `EMBEDDING_MODEL` | No | Embedding model for the Knowledge Base (default `text-embedding-3-small`). Must be served by the same `LLM_API_BASE` endpoint (LiteLLM supports this). |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_URL` | Yes | Full URL of the frontend (e.g. `https://oficina.aither.systems`) |
| `NEXTAUTH_SECRET` | Yes | NextAuth signing secret — generate with `openssl rand -base64 32` |
| `NEXT_PUBLIC_API_URL` | Yes | Backend public URL visible to the browser (e.g. `https://backoffice.aither.systems`) |

---

## LiteLLM Setup

AitherOS uses LiteLLM as a unified LLM proxy. All agent requests go through it, which means you can route to OpenAI, Anthropic, Ollama, Groq, or any OpenAI-compatible provider without changing the orchestrator.

### Minimal `litellm_config.yaml`

```yaml
model_list:
  - model_name: gpt-4o-mini
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: sk-your-openai-key

  - model_name: claude-3-5-haiku
    litellm_params:
      model: anthropic/claude-3-5-haiku-20241022
      api_key: sk-ant-your-anthropic-key

  - model_name: llama3
    litellm_params:
      model: ollama/llama3
      api_base: http://localhost:11434

general_settings:
  master_key: dummy_token   # matches LLM_API_KEY in .env
```

### Start LiteLLM

```bash
pip install litellm
litellm --config litellm_config.yaml --port 4000
```

Once running, set in `.env`:
```
LLM_API_BASE=http://127.0.0.1:4000/v1
LLM_API_KEY=dummy_token
LLM_MODEL=gpt-4o-mini
```

Any model name you define in `litellm_config.yaml` can then be set on an individual agent via `model` field or as the system default via `LLM_MODEL`.

---

## Troubleshooting

### Execution stays in `planning` forever
- Check backend logs: `tail -f logs/backend-error.log`
- The planning phase calls the LLM — verify `LLM_API_BASE` is reachable and `LLM_API_KEY` is valid
- Check if the workforce has at least one active agent with a working provider

### Execution stays in `running` / step never completes
- The agent may be looping — check its `max_iterations` is not too high
- Look at the message stream in the execution detail page for the agent's last output
- An agent stuck in `needs_help` requires a human intervention message via the chat input
- Check for `blocked` subtasks — a subtask enters `blocked` if its `depends_on` subtask never completed

### WebSocket not connecting
- Ensure the `CORS_ORIGINS` env var includes your frontend URL
- The WS endpoint requires a `?token=<jwt>` query param — check the browser console for 401 errors
- Redis must be running for the EventBus to function

### Profile photo not saving
- Uploads are stored in `uploads/` relative to the working directory (i.e. `/opt/AitherOS/uploads/`)
- The backend serves them at `/uploads/*` — check that the backend's file server is running
- Ensure the uploaded file is a valid JPEG, PNG, WebP, or GIF (SVG is rejected for security)

### Agent not using MCP tools
- Verify the MCP server is attached to the workforce (Workforce detail → MCP Tools section)
- Verify the agent has been granted access (Grant All or specific tools)
- Click **Discover Tools** on the MCP server page to refresh the cached tool list
- Check backend logs for MCP connection errors when the execution starts

### Frontend build fails
- Run `cd frontend && npm install` to ensure all dependencies are installed
- Ensure `frontend/.env.local` exists with all required variables
- TypeScript errors are treated as build errors — fix any type issues before building

### Tests failing
- Unit tests: `make test-unit` — no external deps needed
- Integration tests: `make test-integration` — requires a running PostgreSQL and Redis instance
- Run `make setup-test-db` first to create the test database schema

---

## Contributing

1. **Backend changes** — always run `make test-unit` before committing; add tests for new orchestrator logic in `backend/tests/unit/`
2. **DB changes** — always add a numbered migration script in `scripts/` (e.g. `005_your_feature.sql`); never modify existing migration files
3. **API changes** — update `frontend/src/lib/api.ts` with new interface types and methods to keep the typed client in sync
4. **New events** — add the event type constant to `backend/internal/models/event.go` and the corresponding UI config to the execution page's `eventTypeConfig` map
5. **Frontend pages** — follow the existing pattern: `'use client'`, load data in `useEffect` with `session.accessToken`, use `api.*` methods, never call `fetch()` directly
