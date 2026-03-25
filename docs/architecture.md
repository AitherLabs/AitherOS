# AitherOS — High-Level Architecture & Tech Stack

> Autonomous AI Workforce Platform  
> *Draft v0.1 — March 2026*

---

## 1. System Overview (Text Diagram)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND  (Next.js / React)                      │
│                                                                             │
│  ┌──────────────────────┐   ┌──────────────────────┐   ┌────────────────┐  │
│  │   Command Center     │   │  Visual Simulation   │   │  Live Feed /   │  │
│  │   (Dashboard)        │   │  ("The Office")      │   │  Notifications │  │
│  │                      │   │                      │   │                │  │
│  │  • Agent CRUD        │   │  • 2D Isometric Map  │   │  • NL Event    │  │
│  │  • WorkForce Mgmt    │   │  • Agent Avatars     │   │    Stream      │  │
│  │  • Knowledge Bases   │   │  • Real-time State   │   │  • HitL Prompts│  │
│  │  • MCP Server Config │   │  • Chat Bubbles      │   │  • Alerts      │  │
│  │  • Output Routing    │   │  • Tool Animations   │   │                │  │
│  └──────────┬───────────┘   └──────────┬───────────┘   └───────┬────────┘  │
│             │  REST / tRPC             │  WebSocket             │  WS/SSE  │
└─────────────┼──────────────────────────┼───────────────────────┼───────────┘
              │                          │                       │
══════════════╪══════════════════════════╪═══════════════════════╪════════════
              │              API GATEWAY / REVERSE PROXY (Caddy/Traefik)
══════════════╪══════════════════════════╪═══════════════════════╪════════════
              ▼                          ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND  (Go primary + Python sidecar)             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        Go Core Service                              │    │
│  │                                                                     │    │
│  │  ┌────────────┐  ┌────────────────┐  ┌──────────────────────────┐  │    │
│  │  │ REST/gRPC  │  │ WorkForce      │  │  Execution Engine        │  │    │
│  │  │ API Layer  │  │ Orchestrator   │  │  (Continuous Loop)       │  │    │
│  │  │            │  │                │  │                          │  │    │
│  │  │ • CRUD     │  │ • Plan Phase   │  │  • Goroutine per Agent   │  │    │
│  │  │ • Auth     │  │ • HitL Gate    │  │  • Channel-based Comms   │  │    │
│  │  │ • WS Hub   │  │ • Task Router  │  │  • Context Cancellation  │  │    │
│  │  │            │  │ • Strategy Eval│  │  • Token/Time Budgets    │  │    │
│  │  └────────────┘  └───────┬────────┘  └────────────┬─────────────┘  │    │
│  │                          │                        │                │    │
│  │                 ┌────────▼────────────────────────▼──────────┐     │    │
│  │                 │            Event Bus (in-process)          │     │    │
│  │                 │  Go channels  +  Redis Pub/Sub fanout      │     │    │
│  │                 └────────┬──────────────────────┬────────────┘     │    │
│  │                          │                      │                  │    │
│  │               ┌──────────▼──────┐    ┌──────────▼──────────┐      │    │
│  │               │ NL Translator   │    │ Persistence Layer   │      │    │
│  │               │ (event → human  │    │ (PostgreSQL + Redis │      │    │
│  │               │  readable text) │    │  session state)     │      │    │
│  │               └─────────────────┘    └─────────────────────┘      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Python Sidecar Service                          │    │
│  │                                                                     │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
│  │  │ LLM Gateway  │  │ RAG / Vector │  │  MCP Client Bridge       │  │    │
│  │  │              │  │ Store        │  │                          │  │    │
│  │  │ • LiteLLM    │  │ • Qdrant /   │  │  • Connects to user's   │  │    │
│  │  │   passthru   │  │   Weaviate   │  │    MCP servers           │  │    │
│  │  │ • Model-     │  │ • Embedding  │  │  • Wraps tool calls      │  │    │
│  │  │   agnostic   │  │   pipeline   │  │  • Schema discovery      │  │    │
│  │  │ • Streaming  │  │ • Chunk/     │  │                          │  │    │
│  │  │              │  │   Ingest API │  │                          │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Agent Engine Connectors                          │    │
│  │                                                                     │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
│  │  │  PicoClaw    │  │  OpenClaw    │  │  Generic Engine Adapter  │  │    │
│  │  │  Adapter     │  │  Adapter     │  │  (plug-in interface)     │  │    │
│  │  │              │  │              │  │                          │  │    │
│  │  │ Connects to  │  │ Connects to  │  │  Any future engine that  │  │    │
│  │  │ local/remote │  │ local/remote │  │  implements the adapter  │  │    │
│  │  │ PicoClaw     │  │ OpenClaw     │  │  contract                │  │    │
│  │  │ instances    │  │ instances    │  │                          │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
              │                          │                       │
══════════════╪══════════════════════════╪═══════════════════════╪════════════
              │                   DATA / INFRA LAYER             │
══════════════╪══════════════════════════╪═══════════════════════╪════════════
              ▼                          ▼                       ▼
┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────────┐
│   PostgreSQL     │  │   Redis               │  │   Qdrant / Weaviate      │
│                  │  │                       │  │   (Vector DB)            │
│  • Agent defs    │  │  • Session state      │  │                          │
│  • WorkForce cfg │  │  • Pub/Sub event bus  │  │  • Per-agent KBs         │
│  • Execution     │  │  • Rate-limit /       │  │  • "Default Knowledge -  │
│    history       │  │    token counters     │  │     Outputs" auto-ingest │
│  • User/Auth     │  │  • Ephemeral cache    │  │  • Embedding indexes     │
└──────────────────┘  └──────────────────────┘  └──────────────────────────┘
              │                          │                       │
              ▼                          ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OUTPUT ROUTING LAYER                                 │
│                                                                             │
│    ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────────┐   │
│    │  Notion    │  │  Telegram  │  │  Local MD  │  │  Webhooks /       │   │
│    │  Exporter  │  │  Bot       │  │  Writer    │  │  Custom Sinks     │   │
│    └────────────┘  └────────────┘  └────────────┘  └───────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Breakdown

### 2.1 Frontend

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | SSR for dashboard, client components for real-time |
| Styling | **Tailwind CSS + shadcn/ui** | Fast iteration, consistent design system |
| Real-time | **WebSocket (native) + Zustand** | Lightweight state for streaming events |
| Visual Sim | **PixiJS or Phaser** (canvas) | GPU-accelerated 2D rendering for the "Office" view |
| Icons | **Lucide** | Clean, MIT-licensed icon set |

### 2.2 Backend — Why Go + Python Sidecar?

| Language | Role | Why |
|---|---|---|
| **Go** | Core orchestrator, API, WebSocket hub, execution engine | First-class goroutines + channels = natural fit for thousands of concurrent long-running agent loops. Low memory footprint. Context-based cancellation maps perfectly to "halt a WorkForce." |
| **Python** | LLM gateway, RAG pipeline, MCP client bridge | The AI/ML ecosystem lives in Python. LiteLLM, LangChain embeddings, most MCP server SDKs are Python-native. Fighting this is wasteful. |

**Communication between Go ↔ Python:** gRPC (protobuf) over a Unix socket for low-latency, strongly-typed calls. The Python sidecar is a thin service, not a monolith.

> **Why not Rust?** Rust's concurrency model is excellent, but the compile-time cost and smaller ecosystem for rapid LLM tooling integration would slow early iteration. Go offers 80% of the performance benefits with 30% of the friction. Revisit Rust for performance-critical subsystems later (e.g., a custom vector search layer).

### 2.3 Execution Engine — The Continuous Loop

```
                    ┌─────────────────────┐
                    │   Human submits     │
                    │   Objective to      │
                    │   WorkForce         │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   PLANNING PHASE    │
                    │                     │
                    │  Agents negotiate   │
                    │  strategy via       │
                    │  shared message bus │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   HitL GATE         │◄──── Human reviews strategy,
                    │                     │      answers questions,
                    │   Awaiting Approval │      approves / redirects
                    └─────────┬───────────┘
                              │ approved
                              ▼
              ┌───────────────────────────────────┐
              │       EXECUTION LOOP               │
              │                                    │
              │   ┌──────────┐    ┌──────────┐    │
              │   │ Agent A  │◄──►│ Agent B  │    │
              │   │ (gorout.)│    │ (gorout.)│    │
              │   └────┬─────┘    └────┬─────┘    │
              │        │               │          │
              │        ▼               ▼          │
              │   ┌──────────────────────────┐    │
              │   │   Shared Context Store   │    │
              │   │   (Redis + in-memory)    │    │
              │   └──────────────────────────┘    │
              │                                    │
              │   Exit conditions checked each     │
              │   iteration:                       │
              │     1. Objective complete? ──────► DONE ──► Output Routing
              │     2. Budget exhausted?  ──────► HALT ──► Notify Human
              │     3. Manual halt?       ──────► STOP ──► Checkpoint & Save
              │                                    │
              └──────────────────┬─────────────────┘
                                 │ (loop back)
                                 └──► next iteration
```

Each agent runs as a **goroutine** with:
- A **context.Context** carrying deadline/cancellation signals.
- A **channel** for receiving tasks from the orchestrator and peer agents.
- A **token counter** (atomic int) decremented on every LLM call via the Python sidecar.

### 2.4 Agent Engine Connector Architecture

AitherOS acts as an **amplifier and manager** for existing agent engines. The connector layer provides a uniform interface:

```
┌─────────────────────────────────────────────────────┐
│             Connector Interface (Go)                │
│                                                     │
│  Register(config EngineConfig) → EngineHandle       │
│  Submit(handle, task Task) → TaskID                 │
│  Stream(taskID) → chan Event                        │
│  Cancel(taskID) → error                             │
│  Status(handle) → EngineStatus                      │
└──────────────┬──────────────────┬───────────────────┘
               │                  │
      ┌────────▼──────┐  ┌───────▼────────┐
      │  PicoClaw     │  │  OpenClaw      │
      │  Adapter      │  │  Adapter       │
      │               │  │                │
      │  HTTP client  │  │  HTTP/gRPC     │
      │  pointed at:  │  │  client        │
      │  localhost or │  │                │
      │  remote URL   │  │                │
      └───────────────┘  └────────────────┘
```

**Current dev setup (PicoClaw):**
```json
{
  "model_name": "gpt-5.4-mini",
  "model": "gpt-5.4-mini",
  "api_base": "http://127.0.0.1:4000/v1",
  "api_key": "dummy_token"
}
```

The PicoClaw adapter would connect to the local instance, forward tasks in the engine's native format, and stream events back through the unified `chan Event` interface for the orchestrator to consume.

### 2.5 Event Bus → Natural Language Pipeline

```
Agent Action ──► Structured Event (protobuf)
                        │
                        ▼
              Redis Pub/Sub channel
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
    NL Translator   Persistence   WebSocket Hub
    (LLM summary    (PostgreSQL   (fans out to
     or template)    + Qdrant)     all connected
                                   frontends)
```

The NL Translator can be **template-based** for common events (fast, zero-cost) and fall back to a **small LLM summarizer** for complex multi-step narratives.

### 2.6 Data Model (Simplified ERD)

```
┌───────────────┐       ┌───────────────────┐       ┌──────────────────┐
│    User       │       │     Agent         │       │   WorkForce      │
├───────────────┤       ├───────────────────┤       ├──────────────────┤
│ id            │       │ id                │       │ id               │
│ email         │       │ name              │       │ name             │
│ api_keys[]    │       │ system_prompt     │       │ objective        │
└───────┬───────┘       │ instructions      │       │ status (enum)    │
        │               │ tools[] (MCP refs)│       │ budget_tokens    │
        │ owns          │ knowledge_bases[] │       │ budget_time      │
        ▼               │ engine_type       │       │ created_by (FK)  │
   ┌────────────┐       │ engine_config {}  │       └────────┬─────────┘
   │ Many-to-   │       │ created_by (FK)   │                │
   │ many       │       └────────┬──────────┘                │ has many
   └────────────┘                │                           │
                                 │ belongs to                ▼
                                 ▼                  ┌──────────────────┐
                        ┌───────────────────┐       │ Execution        │
                        │ WorkForceAgent    │       ├──────────────────┤
                        │ (join table)      │       │ id               │
                        ├───────────────────┤       │ workforce_id(FK) │
                        │ workforce_id (FK) │       │ strategy_json    │
                        │ agent_id (FK)     │       │ status (enum)    │
                        │ role_in_workforce │       │ tokens_used      │
                        └───────────────────┘       │ started_at       │
                                                    │ ended_at         │
                                                    │ events[]         │
                                                    └──────────────────┘
```

---

## 3. Tech Stack Summary

| Layer | Technology | Notes |
|---|---|---|
| **Frontend** | Next.js 15, Tailwind, shadcn/ui, PixiJS | |
| **API** | Go (Fiber or Echo) + gRPC | REST for CRUD, WS for streaming |
| **Orchestration** | Go (goroutines + channels) | Core loop, state machine |
| **LLM Gateway** | Python + LiteLLM | Points at `http://127.0.0.1:4000/v1` or any proxy |
| **RAG** | Python + LangChain/LlamaIndex | Embedding + retrieval |
| **MCP Client** | Python (MCP SDK) | Bridges to user MCP servers |
| **Engine Connectors** | Go adapters (PicoClaw, OpenClaw) | Unified interface |
| **Event Bus** | Redis Pub/Sub + Go channels | Hybrid: in-proc fast path, cross-proc fanout |
| **Primary DB** | PostgreSQL 16 | Agent/WorkForce/Execution metadata |
| **Cache/State** | Redis 7 | Session state, token counters, ephemeral data |
| **Vector DB** | Qdrant (self-hosted) | Per-agent KBs + Default Knowledge Outputs |
| **Output Routing** | Go workers + plugin interface | Notion, Telegram, MD, webhooks |
| **Infra** | Docker Compose (dev), Kubernetes (prod) | |
| **Auth** | JWT + API keys | Simple to start, OIDC later |

---

## 4. Viability Analysis & Honest Opinions

### Is it viable? **Yes, with caveats.**

#### Strengths — Why This Can Work

1. **Real market pain.** Current agent platforms (CrewAI, AutoGen, Dify) are either too rigid (visual DAGs that break on dynamic tasks) or too low-level (raw Python scripts). There is a genuine gap for a **managed, continuous-loop orchestrator with human oversight**. Enterprise and security teams especially need this.

2. **The "amplifier" positioning is smart.** By not building yet-another-agent-runtime but instead wrapping PicoClaw/OpenClaw/etc., you avoid the hardest problem (making agents actually good) and focus on the highest-value layer: orchestration, visibility, and control. This is analogous to how Kubernetes doesn't run your code — it orchestrates containers that do.

3. **Human-in-the-Loop is a differentiator.** Most agent frameworks are either fully autonomous (dangerous, unreliable) or fully manual (defeats the purpose). The planning → approval → autonomous loop → checkpoint cycle is the right UX pattern for real-world deployment where trust must be built incrementally.

4. **The "Office" visual is a strong moat for developer experience.** It sounds gimmicky, but visual feedback for opaque AI processes dramatically increases user trust and engagement. It's also a marketing asset — demos sell.

5. **MCP support is timely.** MCP is rapidly becoming the standard for tool integration. Building around it now puts you ahead of most orchestration platforms.

#### Risks & Hard Problems

1. **Agent quality is still upstream.** Your platform is only as good as the underlying agents. If PicoClaw/OpenClaw produce unreliable outputs, your orchestrator will orchestrate garbage beautifully. **Mitigation:** Build strong evaluation/scoring into the execution loop so the system can self-correct or escalate early.

2. **"Infinite loop" resource management is non-trivial.** Long-running agent loops can burn tokens fast. A single poorly-prompted agent in a feedback loop can cost hundreds of dollars in minutes. **Mitigation:** Hard per-iteration token caps, exponential backoff on repeated failures, and mandatory cost projections shown during the HitL approval gate.

3. **Inter-agent communication is an unsolved research problem.** Getting agents to "negotiate a strategy" sounds great in a spec, but in practice, LLM-to-LLM conversations often degenerate into agreement loops or tangential drift. **Mitigation:** Use structured message schemas (not free-text chat) for inter-agent comms, and impose a turn limit on the planning phase.

4. **Scope creep is the #1 killer.** You've described a dashboard, a visual office, RAG, MCP, output routing to Notion/Telegram, multiple engine adapters, etc. That's 6-12 months of work for a focused team. **Strong recommendation:** Ship an MVP with (a) Agent CRUD, (b) single WorkForce execution loop, (c) terminal-style event feed, (d) PicoClaw adapter only. Add the Office visual, multi-engine support, and output routing as v1.1+.

5. **Monetization path is unclear.** Open-source orchestrators are free. SaaS agent platforms (e.g., Relevance AI) exist. Your edge is the "bring your own engine + bring your own proxy" self-hosted story, which appeals to security teams and enterprises — but those are slow sales cycles. Consider a hosted tier for indie hackers alongside the self-hosted version.

#### Is It a Good Product?

**Yes, if you nail the execution loop and keep scope tight.** The core value proposition — "connect your agent engines, define teams with objectives, approve a plan, let them run, watch in real-time, get structured outputs" — is compelling and underserved. The risk isn't the idea; it's building too much before validating that the core loop (WorkForce planning → HitL → execution → output) actually produces reliable results with real tasks.

**My recommendation:** Build the thinnest possible vertical slice first. One WorkForce, two agents (e.g., a researcher + a writer), one PicoClaw instance, one objective, text-only event feed. Get that loop producing a useful output end-to-end. Everything else is polish on top of a working engine.

---

## 5. Suggested MVP Milestones

| Phase | Scope | Timeline (est.) |
|---|---|---|
| **M0 — Skeleton** | Go API, PostgreSQL schema, Python sidecar with LiteLLM proxy passthrough, PicoClaw adapter hello-world | 2 weeks |
| **M1 — Single Agent** | Agent CRUD, single-agent execution loop via PicoClaw, event streaming to terminal | 2 weeks |
| **M2 — WorkForce** | Multi-agent orchestration, planning phase, HitL approval gate, basic token budgeting | 3 weeks |
| **M3 — Dashboard** | Next.js Command Center: agent config, WorkForce management, live event feed | 3 weeks |
| **M4 — RAG + MCP** | Knowledge base upload/ingest, MCP server connection UI, tool execution | 3 weeks |
| **M5 — The Office** | PixiJS visual simulation, avatar states, real-time event mapping | 4 weeks |
| **M6 — Output Routing** | Notion/Telegram/MD exporters, Default Knowledge auto-ingest | 2 weeks |

---

## 6. Repository Structure (Proposed)

```
AitherOS/
├── docs/                     # You are here
├── cmd/
│   └── aitherd/              # Go main binary
│       └── main.go
├── internal/
│   ├── api/                  # HTTP/WS handlers
│   ├── orchestrator/         # WorkForce execution engine
│   ├── engine/               # Agent engine adapters
│   │   ├── connector.go      # Interface definition
│   │   ├── picoclaw/         # PicoClaw adapter
│   │   └── openclaw/         # OpenClaw adapter
│   ├── eventbus/             # Redis pub/sub + channels
│   ├── models/               # Domain types
│   └── store/                # PostgreSQL repositories
├── sidecar/                  # Python service
│   ├── llm_gateway/          # LiteLLM wrapper
│   ├── rag/                  # Vector store operations
│   ├── mcp_bridge/           # MCP client
│   └── requirements.txt
├── frontend/                 # Next.js app
│   ├── app/
│   ├── components/
│   │   ├── command-center/
│   │   └── office/           # PixiJS visual sim
│   └── package.json
├── proto/                    # Protobuf definitions
├── docker-compose.yml
├── Makefile
└── README.md
```

---

*This document is a living artifact. Update it as architectural decisions are validated or revised.*
