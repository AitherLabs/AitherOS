# AitherOS — Pre-Build Investigation Report

> Research conducted March 2026  
> Goal: Identify OSS repos to clone/fork or use as inspiration before writing code

---

## TL;DR — Recommended Action Plan

| Layer | Clone/Fork as Base? | Repo | Why |
|---|---|---|---|
| **Backend (Go orchestration)** | ❌ No — write from scratch | — | Nothing matches our architecture closely enough. Existing Go agent platforms (GoClaw, Eino) solve different problems. |
| **Backend (Go scaffolding)** | ✅ Use as reference | `cloudwego/eino` | Best Go-native agent framework. Study its component abstractions, interrupt/resume, and callback patterns. Don't fork — cherry-pick ideas. |
| **Backend (Python sidecar)** | ✅ Use LiteLLM directly | `BerriAI/litellm` | Already running on `:4000`. Wrap it, don't reinvent it. |
| **Frontend (Dashboard)** | ✅ Clone as starter | `Kiranism/next-shadcn-dashboard-starter` | Next.js 16 + shadcn/ui + Tailwind + TypeScript. Feature-based folder structure. Perfect CRUD scaffold. |
| **Frontend (Office Visual)** | ✅ Heavy inspiration | `harishkotra/agent-office` | Phaser.js + React + Colyseus architecture is exactly what we need for v2. Study it, don't ship it in MVP. |
| **Agent creation UX** | ✅ Study | `langgenius/dify` | Best-in-class agent config UI (system prompts, tools, knowledge bases). Study their React forms. |

---

## 1. Backend Repos Investigated

### 1.1 GoClaw (`nextlevelbuilder/goclaw`) ⭐ Most Relevant Go Repo

**What it is:** OpenClaw rebuilt in Go. Single ~25MB binary. Multi-tenant PostgreSQL. Agent teams with delegation.

**Relevant features:**
- Agent teams with shared task boards and inter-agent delegation (sync/async)
- Multi-tenant PostgreSQL with per-user workspaces and encrypted API keys (AES-256-GCM)
- 20+ LLM providers including any OpenAI-compatible endpoint
- 7 messaging channels (Telegram, Discord, Slack, etc.)
- Heartbeat system for agent check-ins
- Scheduling & cron for automated tasks
- Built-in LLM call tracing with OpenTelemetry

**Why NOT fork it:**
- It's a **chat gateway** (Telegram/Discord → agent), not a **workforce orchestrator**
- No concept of "objectives" or "planning phases" or HitL approval gates
- No continuous execution loop — it's request/response
- No event bus or NL traceability
- Tied to its own agent runtime, not an "amplifier" for PicoClaw/OpenClaw

**What to steal:**
- PostgreSQL schema patterns for agent definitions and multi-tenancy
- The adapter pattern for multiple LLM providers
- Agent delegation protocol ideas

**Repo:** https://github.com/nextlevelbuilder/goclaw

---

### 1.2 Eino (`cloudwego/eino`) ⭐ Best Go Agent Framework

**What it is:** ByteDance's LLM application framework in Go. LangChain-equivalent for Go.

**Relevant features:**
- Component abstractions: ChatModel, Tool, Retriever, Embedding, ChatTemplate
- Graph/workflow composition with `.then()`, branching, parallel execution
- **Interrupt/Resume for human-in-the-loop** — agents pause for human input, framework handles state persistence
- Streaming throughout orchestration (auto-concatenation, merging, copying)
- Callback aspects: OnStart, OnEnd, OnError with tracing/metrics injection
- Official implementations for OpenAI, Claude, Gemini, Ollama, Elasticsearch

**Why NOT fork it:**
- It's a **library**, not a **platform** — no REST API, no dashboard, no persistence layer
- No concept of "WorkForces" or team-based orchestration
- We'd be building on top of it, not forking it

**What to steal:**
- The interrupt/resume pattern for HitL gates — this is exactly what we need
- Component interface design (how they abstract ChatModel, Tool, Retriever)
- Callback/aspect system for our event bus
- Stream processing patterns

**Repo:** https://github.com/cloudwego/eino  
**HitL example:** https://github.com/cloudwego/eino-examples/tree/main/adk/human-in-the-loop

---

### 1.3 CrewAI (`crewAIInc/crewAI`) ⭐ Closest Conceptual Match

**What it is:** Python framework for orchestrating role-playing AI agents in "Crews."

**Relevant features:**
- **Crews** = our "WorkForces" — teams of agents with roles, goals, and backstories
- Task delegation between agents
- Built-in memory (short-term, long-term, entity memory)
- Tool integration
- Process types: sequential, hierarchical

**Why NOT fork it:**
- Python-only, we want Go core for concurrency
- No continuous execution loop — crews run a task and finish
- No real HitL gate (human input is just a tool call, not a first-class flow)
- No event bus or real-time streaming to a frontend
- The "crew" abstraction is close but too rigid for infinite loops
- 44k stars but the commercial platform (CrewAI Enterprise) is where the real features are

**What to steal:**
- The **crew/agent/task mental model** — it maps directly to our WorkForce/Agent/Objective
- How they define agent roles via YAML configs
- Their memory architecture (short-term + long-term + entity)

**Repo:** https://github.com/crewAIInc/crewAI

---

### 1.4 MetaGPT (`FoundationAgents/MetaGPT`) ⭐ "Software Company" Model

**What it is:** Multi-agent framework that simulates a software company. Agents have roles (PM, Architect, Engineer, QA).

**Relevant features:**
- Role-based agent definitions with SOPs
- Agents communicate via a shared message pool (publish/subscribe)
- Structured output schemas between agents
- The "software company" metaphor maps to our "workforce" metaphor

**Why NOT fork it:**
- Python-only
- Hyper-specialized for software development tasks
- Academic project, not production infrastructure
- No REST API, no dashboard, no persistence

**What to steal:**
- The **structured message bus** between agents (not free-text chat)
- SOP (Standard Operating Procedure) patterns for agent instructions
- The publish/subscribe communication model

**Repo:** https://github.com/FoundationAgents/MetaGPT

---

### 1.5 Dify (`langgenius/dify`) ⭐ Best Agent Creation UX

**What it is:** Production-ready platform for agentic workflow development. 129k+ stars. The giant in this space.

**Architecture:**
- **Backend:** Python (Flask) API service
- **Frontend:** React + React Flow for visual workflow builder
- **DB:** PostgreSQL + Redis + Weaviate/Qdrant
- **Worker:** Celery for async task execution
- Deployed via Docker + Nginx

**Relevant features:**
- Beautiful agent configuration UI (system prompts, tools, knowledge bases)
- RAG pipeline with multiple vector DB backends
- Visual workflow builder (React Flow)
- LLM gateway supporting hundreds of models
- Plugin/tool marketplace

**Why NOT fork it:**
- **Massive codebase** (~500k+ lines) — way too much to strip down
- Workflow-oriented (DAGs), not continuous-loop-oriented
- No concept of autonomous teams or WorkForces
- Python Flask backend — we want Go for concurrency
- Their abstraction is "apps" (chatbots, workflows), not "workforces"
- Forking Dify and trying to bolt on our features would be harder than building from scratch

**What to steal:**
- **Agent configuration forms** — study their React components for system prompt editing, tool selection, knowledge base management
- **RAG pipeline** — how they handle document upload → chunking → embedding → retrieval
- **LLM model selection UI** — model picker with provider/model/params

**Repo:** https://github.com/langgenius/dify

---

### 1.6 Mastra (`mastra-ai/mastra`) — TypeScript Alternative

**What it is:** TypeScript-first agent framework by the Gatsby team. YC-backed. 21k stars.

**Relevant features:**
- Workflows with suspend/resume for human-in-the-loop
- Agent networking (routing agents delegate to sub-agents)
- 4-tier memory: message history, working memory, semantic recall, RAG
- Local dev playground in browser
- 81 LLM providers via Vercel AI SDK

**Why NOT fork it:**
- TypeScript-only — doesn't fit our Go backend plan
- Library, not a platform
- No concept of continuous loops or team objectives

**What to steal:**
- The **4-tier memory model** is well-designed
- The dev playground concept for testing agents in-browser
- Suspend/resume flow for HitL

**Repo:** https://github.com/mastra-ai/mastra

---

## 2. Frontend Repos Investigated

### 2.1 `Kiranism/next-shadcn-dashboard-starter` ⭐⭐ CLONE THIS

**What it is:** Production-ready admin dashboard starter. Next.js 16 + shadcn/ui + Tailwind CSS v4 + TypeScript.

**Features:**
- Feature-based folder structure for scalable projects
- Parallel routes with independent loading/error handling
- Auth scaffolding
- CRUD patterns with forms (react-hook-form + zod)
- Data tables with search, filter, sort, pagination
- Responsive sidebar navigation
- Zustand for state management
- Ready for SaaS dashboards and internal tools

**Why clone it:**
- It's literally the tech stack we chose (Next.js + shadcn + Tailwind + TypeScript)
- Feature-based folder structure means we can add `agents/`, `workforces/`, `events/` as features
- CRUD patterns directly map to Agent CRUD
- Data tables for execution logs / event feeds
- Already has auth scaffolding

**What we'd add on top:**
- WebSocket connection for real-time event streaming
- Agent configuration forms (inspired by Dify)
- WorkForce management views
- Terminal-style event feed component

**Repo:** https://github.com/Kiranism/next-shadcn-dashboard-starter

---

### 2.2 `harishkotra/agent-office` ⭐ Best "Office" Visual Reference

**What it is:** Pixel art office where AI agents walk, think, collaborate, hire, and execute tools. Real-time via Colyseus.

**Architecture:**
- `@agent-office/core` — Agent state machine, memory, tasks, office grid
- `@agent-office/adapters` — OllamaAdapter, OpenAICompatibleAdapter
- `@agent-office/server` — Colyseus rooms, ToolExecutor, MemoryStore (SQLite)
- `@agent-office/ui` — **Phaser.js** game + React overlay (Chat, TaskBoard, SystemLog)
- `@agent-office/cli` — Scaffold & management commands

**Why it matters for us:**
- **Phaser.js + React overlay** is the exact pattern we need for "The Office" visual
- Agent state machine (idle → walk → type/read) maps to our agent status states
- Colyseus for real-time state sync is battle-tested for game-like UIs
- The modular package structure is clean

**Why NOT fork it:**
- It's coupled to Ollama as the LLM backend
- The agent logic is baked into the visual layer — we need separation (our Go backend owns agent state, frontend just renders)
- It's a standalone toy, not a platform
- MIT licensed but it's v0.x quality

**What to steal (for v2, post-MVP):**
- Phaser.js office rendering patterns
- Agent state machine → animation mapping
- The React overlay on top of game canvas pattern
- Office grid/pathfinding system

**Repo:** https://github.com/harishkotra/agent-office

---

### 2.3 `ringhyacinth/Star-Office-UI` ⭐ Original "Office" Inspiration

**What it is:** Pixel-art AI office dashboard for OpenClaw. Flask backend + vanilla JS frontend.

**Features:**
- 6 agent states: idle, writing, researching, executing, syncing, error
- Agent avatars move to different areas based on state
- "Yesterday's Notes" from memory files
- Multi-agent collaboration via join keys
- Chinese/English/Japanese i18n
- Cloudflare Tunnel support (relevant — you're using this too!)

**Architecture:**
- Backend: Flask (Python)
- Frontend: Vanilla HTML/JS
- State: JSON files on disk

**Why NOT fork it:**
- Vanilla JS, no React/canvas — we'd rewrite everything
- Flask backend — we're using Go
- JSON file state — we need PostgreSQL
- Very simple / single-purpose

**What to steal:**
- The **6 agent states** concept (idle/writing/researching/executing/syncing/error) — adopt these as our agent status enum
- The "join key" concept for multi-agent collaboration
- Their Cloudflare Tunnel deployment pattern

**Repo:** https://github.com/ringhyacinth/Star-Office-UI

---

### 2.4 `pablodelucca/pixel-agents` ⭐ VS Code Extension (Vision Match)

**What it is:** VS Code extension that turns Claude Code agents into pixel art characters. React 19 + Canvas 2D.

**Features:**
- One agent = one character with live activity tracking
- Characters animate based on agent actions (typing, reading, running commands)
- Office layout editor with built-in furniture
- Speech bubbles for waiting/permission states
- Sub-agent visualization (parent-child agent trees)
- JSONL transcript file watching (observational, non-invasive)

**Vision statement:** *"Managing AI agents should feel like playing The Sims, but the results are real."*

**Architecture:**
- Extension: TypeScript, VS Code Webview API, esbuild
- Webview: React 19, TypeScript, Vite, Canvas 2D
- BFS pathfinding + character state machine

**Why it matters:**
- Their **long-term vision is identical to ours** — they want agent-agnostic, platform-agnostic orchestration with a game-like visual
- Currently VS Code only, but explicitly planning Electron/web app
- The character state machine and pathfinding code could be adapted

**Why NOT fork it:**
- VS Code extension, not a web app
- Claude Code specific (watches JSONL transcripts)
- No backend — it's purely observational

**What to steal (for v2):**
- Character state machine (idle → walk → type/read)
- The "desks as directories" metaphor
- Agent inspection panel (model, prompt, history, stats)
- Token health bars as visual indicators

**Repo:** https://github.com/pablodelucca/pixel-agents

---

## 3. Summary Matrix

| Repo | Stars | Language | Clone? | Use as | Relevance |
|---|---|---|---|---|---|
| `crewAIInc/crewAI` | 44k | Python | No | Conceptual model (crews/agents/tasks) | ⭐⭐⭐⭐ |
| `langgenius/dify` | 129k | Python/React | No | Agent config UI patterns | ⭐⭐⭐⭐ |
| `cloudwego/eino` | ~5k | **Go** | No | HitL interrupt/resume, component design | ⭐⭐⭐⭐ |
| `nextlevelbuilder/goclaw` | ~1k | **Go** | No | PostgreSQL schema, LLM adapter patterns | ⭐⭐⭐ |
| `FoundationAgents/MetaGPT` | 50k+ | Python | No | Structured inter-agent messaging | ⭐⭐⭐ |
| `mastra-ai/mastra` | 21k | TypeScript | No | Memory tiers, suspend/resume | ⭐⭐⭐ |
| **`Kiranism/next-shadcn-dashboard-starter`** | 6k | **TS/Next.js** | **YES** | **Dashboard base** | ⭐⭐⭐⭐⭐ |
| `harishkotra/agent-office` | ~2k | TS/Phaser | No | Office visual patterns (v2) | ⭐⭐⭐⭐ |
| `ringhyacinth/Star-Office-UI` | ~1k | Python/JS | No | Agent state enum, Cloudflare patterns | ⭐⭐ |
| `pablodelucca/pixel-agents` | ~3k | TS/React | No | Vision alignment, character state machine | ⭐⭐⭐ |

---

## 4. Verdict: Build From Scratch, With Smart Inspiration

**No single repo can be forked as our base.** The reason is simple: AitherOS sits at a unique intersection that nobody has built yet:

1. **Go-native backend** (for concurrency) — most agent platforms are Python
2. **Orchestrator of external engines** (PicoClaw/OpenClaw) — everyone else builds their own runtime
3. **Continuous execution loops** with HitL gates — everyone else does request/response or DAGs
4. **Real-time visual office** — only toy projects have attempted this

### The Plan

**Frontend:** Clone `Kiranism/next-shadcn-dashboard-starter` and build on top of it. This gives us Next.js 16 + shadcn/ui + CRUD scaffolding out of the box.

**Backend:** Write from scratch in Go, borrowing patterns from:
- **Eino** → interrupt/resume, component abstractions
- **CrewAI** → crew/agent/task mental model
- **GoClaw** → PostgreSQL schema patterns
- **MetaGPT** → structured inter-agent message bus

**Office Visual (v2, post-MVP):** Study `agent-office` (Phaser.js architecture) and `pixel-agents` (character state machine).

---

## 5. MVP Infrastructure Plan

### Ports & Domains

| Service | Local Port | Domain (via Cloudflare Tunnel) |
|---|---|---|
| **Frontend (Next.js)** | `3000` | `oficina.aither.systems` |
| **Backend (Go API)** | `8080` | `backoffice.aither.systems` |
| **PicoClaw** (existing) | `55000` | — (internal only) |
| **LiteLLM Proxy** (existing) | `4000` | — (internal only) |

### PM2 Process Config

```yaml
# ecosystem.config.js (to be created at project root)
apps:
  - name: aitheros-backend
    script: ./bin/aitherd
    cwd: /opt/AitherOS
    env:
      PORT: 8080
      DATABASE_URL: postgres://...
      REDIS_URL: redis://localhost:6379
      PICOCLAW_URL: http://127.0.0.1:55000
      LLM_API_BASE: http://127.0.0.1:4000/v1
      LLM_API_KEY: dummy_token
      LLM_MODEL: gpt-5.4-mini

  - name: aitheros-frontend
    script: npm
    args: start
    cwd: /opt/AitherOS/frontend
    env:
      PORT: 3000
      NEXT_PUBLIC_API_URL: https://backoffice.aither.systems
      NEXT_PUBLIC_WS_URL: wss://backoffice.aither.systems/ws

  - name: aitheros-sidecar
    script: python
    args: -m uvicorn main:app --host 0.0.0.0 --port 8081
    cwd: /opt/AitherOS/sidecar
    env:
      LLM_API_BASE: http://127.0.0.1:4000/v1
      LLM_API_KEY: dummy_token
```

### Cloudflare Tunnel Config (your side)

```yaml
# Add these to your cloudflared config:
ingress:
  - hostname: oficina.aither.systems
    service: http://localhost:3000
  - hostname: backoffice.aither.systems
    service: http://localhost:8080
```

---

## 6. What We Build (MVP Scope, Restated)

| Feature | Description | Test Coverage |
|---|---|---|
| **(a) Agent CRUD** | Create, read, update, delete agents with personality, instructions, engine config | Unit tests for all CRUD ops + API integration tests |
| **(b) Single WorkForce Loop** | Create a WorkForce, assign agents, submit objective, planning → HitL → execution → completion | Unit tests for state machine transitions, integration test for full loop |
| **(c) Terminal Event Feed** | WebSocket endpoint streaming NL events to frontend, rendered as a scrolling terminal | Unit tests for event serialization, WS connection tests |
| **(d) PicoClaw Adapter** | HTTP client connecting to `127.0.0.1:55000`, forwarding tasks, streaming responses | Unit tests with mock PicoClaw server, integration test with real instance |

### Backend Test Strategy
- **Unit tests:** Every domain function, every state transition, every adapter method
- **Integration tests:** Full API round-trips, WebSocket lifecycle, PicoClaw adapter against a mock server
- **Framework:** Go's built-in `testing` package + `testify` for assertions + `httptest` for API tests

---

*Ready to start building. Awaiting confirmation on ports/domains and Cloudflare tunnel setup.*
