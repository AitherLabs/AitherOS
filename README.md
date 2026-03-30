<div align="center">
  <img src="frontend/public/assets/favicon.png" alt="AitherOS" width="80" />

  <h1>AitherOS</h1>

  <p><strong>The Operating System for Autonomous AI Teams</strong></p>

  <p>
    <a href="https://github.com/AitherLabs/AitherOS/releases"><img src="https://img.shields.io/github/v/release/AitherLabs/AitherOS?color=9A66FF&label=version&style=flat-square" alt="Version" /></a>
    <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=flat-square" alt="License: AGPL v3" /></a>
    <img src="https://img.shields.io/badge/open--source-AGPLv3-56D090?style=flat-square" alt="Open Source" />
    <img src="https://img.shields.io/badge/stack-Go%20%2B%20Next.js-FFBF47?style=flat-square" alt="Stack" />
    <img src="https://img.shields.io/badge/real--time-WebSocket-14FFF7?style=flat-square" alt="Real-time" />
    <img src="https://img.shields.io/github/stars/AitherLabs/AitherOS?style=flat-square&color=9A66FF" alt="Stars" />
  </p>
</div>

---

AitherOS is an **open-source platform for building and running autonomous multi-agent AI teams**. Compose specialized agents into workforces that plan together, share long-term memory, use tools via the Model Context Protocol (MCP), and produce results through genuine coordination — not just sequential chaining or parallel API calls.

If you've outgrown single-agent prompting and need a real **LLM orchestration layer** with a live dashboard, human-in-the-loop controls, credential management, and a task board — AitherOS is built for that.

> Looking for an open-source AutoGen alternative? An open-source CrewAI alternative with a real UI? A LangGraph alternative that handles memory, tools, and real-time visibility out of the box? That's exactly what AitherOS is.

---

## Why AitherOS

Most agent frameworks give you a library. AitherOS gives you a running system — with a UI, a database, a tool layer, a credential vault, and an event bus, all wired together.

| Feature | AitherOS | AutoGen | CrewAI | LangGraph |
|---|:---:|:---:|:---:|:---:|
| Self-hosted web UI | ✅ | ❌ | ❌ | ❌ |
| Real-time execution visibility | ✅ | ❌ | ❌ | ❌ |
| Built-in MCP tool layer (50+ tools) | ✅ | ❌ | ❌ | ❌ |
| Long-term memory / RAG per team | ✅ | ❌ | Partial | ❌ |
| Human-in-the-loop intervention | ✅ | Partial | Partial | ✅ |
| Encrypted credential vault | ✅ | ❌ | ❌ | ❌ |
| Kanban task board + autonomous loop | ✅ | ❌ | ❌ | ❌ |
| Native image generation | ✅ | ❌ | ❌ | ❌ |
| Mix providers within one team | ✅ | ✅ | ✅ | ✅ |
| Backend language | Go | Python | Python | Python |

**Coordination-first design.** The core insight behind AitherOS is that agent quality comes from structured coordination, not just better prompts. Each execution goes through a planning phase, a discussion where agents debate strategy, coordinated execution rounds where agents can consult peers mid-task, a synthesis step where results are assembled, and a QA review that checks the output against the task's acceptance criteria. This produces more coherent, higher-quality results than routing agents through a graph or chaining them in sequence.

---

## What it looks like

**The Floor** — a live virtual workspace showing every agent in your system, their current status, and live connections between them. Not a log file. Not a metrics dashboard. A room you can read at a glance while agents are working.

**Workforces** — isolated AI teams, each with their own workspace directory, credential vault, MCP tool server, knowledge base, kanban board, and execution history. Add agents to a workforce, define the objective, and let them work.

**Executions** — missions with a full lifecycle: planning → discussion → execution rounds → peer consultation → synthesis → QA review → knowledge ingestion. You can watch every agent message and tool call in real time, halt and guide at any point, and resume where you left off.

**Kanban Board** — agents populate an Open backlog with tasks. You drag tasks from Open to To Do (with an optional reason recorded for audit). The autonomous scheduler picks up To Do tasks sequentially, runs a full execution for each, and routes them to Done (QA passed) or Blocked (QA flagged issues for human review).

**Knowledge Base** — after every execution, the result and agent messages are automatically embedded into the workforce's vector knowledge base using pgvector cosine similarity search. The next execution draws on everything the team has learned. Memory compounds across missions.

---

## Core Capabilities

### Multi-Agent Orchestration

Agents run in coordinated rounds against a shared structured plan. The orchestrator handles subtask assignment, round-robin execution scheduling, token budget enforcement, deadlock detection (agents stuck in tool loops), and final synthesis.

This is not a pipeline. Agents share execution context and can trigger **peer consultations** mid-task — asking another agent a specific question and waiting for the answer before continuing. The leader agent drives the discussion and synthesis phases; specialist agents focus on their domain.

Key orchestration concepts implemented:
- Structured plan generation with per-agent subtask decomposition
- Coordinated execution rounds with context propagation
- Peer-to-peer consultation protocol (agent-to-agent questions mid-execution)
- Deadlock detection and automatic recovery
- Human intervention injection without restarting the execution
- Halt / resume with subtask state preservation

### Long-Term Memory (Retrieval-Augmented Generation)

Every workforce has an isolated vector knowledge base backed by PostgreSQL + pgvector. After each execution completes, the final result and significant agent messages are automatically embedded using your configured embedding endpoint (any OpenAI-compatible embeddings API).

At execution time, the top-3 semantically similar knowledge entries (cosine similarity ≥ 0.3) are injected into each agent's subtask context as `## Your Long-Term Memory`. Teams accumulate institutional knowledge. A research team that ran 50 reports develops a corpus of findings. A coding team that shipped 20 features retains architectural decisions.

### Model Context Protocol (MCP) Tool Layer

Every workforce automatically provisions an isolated instance of **Aither-Tools** — a built-in MCP server that gives agents access to 50+ tools across categories:

| Category | Tools |
|---|---|
| Filesystem | read, write, list, copy, move, delete, find, search |
| Shell | execute commands, background processes, environment |
| Git | clone, commit, branch, diff, log, status |
| Web | HTTP requests, web search, scraping, link extraction |
| Network | ping, DNS lookup, port scan, HTTP health check |
| Knowledge | search long-term memory, write to knowledge base |
| Kanban | list tasks, create tasks, update status |
| Secrets | `get_secret(service, key)` — reads from encrypted vault |
| Media | `generate_image` — calls image generation APIs |
| System | processes, system info, disk usage |

MCP (Model Context Protocol) is the emerging standard for connecting LLMs to tools and external systems, developed by Anthropic and now adopted across the industry. AitherOS implements MCP over stdio transport with full session management — you can attach any MCP-compatible server to a workforce alongside Aither-Tools.

Each agent has a configurable **tool permission matrix**: grant all tools, or restrict to a specific subset. Tool permissions are enforced at the session level.

### Autonomous Task Loop

The kanban board is the interface between human judgment and autonomous execution:

1. **Agent populates backlog** — the leader agent runs a planning execution and creates kanban tasks in the Open column with titles, descriptions (acceptance criteria), and priorities
2. **Human approves** — drag tasks from Open to To Do. An optional reason is recorded with a timestamp in the task's audit trail
3. **Autonomous scheduler** — when autonomous mode is on, the scheduler picks the highest-priority To Do task every N minutes, starts a full execution from it, links the execution to the task, and moves it to In Progress
4. **Post-execution QA** — after completion, an LLM reviews the execution output against the task's acceptance criteria. Passes → Done. Flags issues → Blocked for human review

Toggle autonomous mode off at any point. The current execution completes, then the loop pauses. Resume by toggling it back on.

### Real-Time Execution Visibility

The frontend connects over WebSocket. The event bus (Redis pub/sub + in-process Go channels) streams every event — agent messages, tool calls, tool results, peer consultations, status changes, approval requests — to all connected clients within milliseconds.

You can:
- Watch every LLM response and tool call as it happens
- **Intervene** — inject a guidance message into a running execution without halting it
- **Halt** — pause execution mid-round with full state preservation
- **Resume** — continue from the exact subtask that was interrupted
- **Approve/reject** the strategy before execution begins
- Provide human answers when agents request help

### Multi-Provider LLM Support

Connect any LLM through an OpenAI-compatible interface. AitherOS resolves the right connector per-agent at runtime based on the agent's provider configuration.

Supported provider types:
- **OpenAI** — GPT-4o, GPT-4 Turbo, o1, o3-mini, etc.
- **Anthropic (via LiteLLM)** — Claude 3.5 Sonnet, Claude 3 Opus, Haiku
- **Google** — Gemini 1.5 Pro/Flash, Imagen 4.0 (image generation)
- **Cloudflare Workers AI** — Llama 3, Mistral, Flux.1 Schnell (image), Whisper (audio)
- **fal.ai** — Flux, SDXL, and other image/video models
- **LiteLLM** — proxy for 100+ models behind a single OpenAI-compatible endpoint
- **Any OpenAI-compatible endpoint** — Ollama, vLLM, Together, Groq, etc.

Mix providers within a single workforce: one agent on GPT-4o for reasoning, another on Gemini for code, a media agent on Imagen for image generation. Model type detection (text / embedding / image / video / audio) determines which connector is used.

### Encrypted Credential Vault

Per-workforce secrets encrypted at rest using AES-256-GCM with a per-installation encryption key. Agents call `get_secret("github", "token")` at runtime through Aither-Tools — the MCP server fetches and decrypts on demand. No credentials in environment variables, no shared secrets leaking between teams, no plaintext in the database.

### Native Image Generation

The `generate_image(prompt, output_path, aspect_ratio)` tool in Aither-Tools calls the image generation API configured for the workforce's media agent. Supports:

- **Google Imagen 4.0** — `:predict` endpoint with Vertex AI body format
- **Google Gemini image models** — `generateContent` with `responseModalities: ["IMAGE"]`
- **OpenAI DALL-E 3** — via OpenAI images API
- **Cloudflare Workers AI** — Flux.1 Schnell, Stable Diffusion, and any `@cf/` image model (auto-synced from your account)
- **fal.ai** — Flux, SDXL, and other models via fal.run

The orchestrator injects image provider credentials from your provider configuration into each workforce's MCP environment automatically.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser / Operator                       │
│              Next.js 16 · React 19 · WebSocket              │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS + WSS
┌──────────────────────────▼──────────────────────────────────┐
│                    AitherOS Backend (Go)                     │
│                                                             │
│  ┌──────────────────┐  ┌────────────────┐  ┌─────────────┐ │
│  │   Orchestrator   │  │   Event Bus    │  │  Knowledge  │ │
│  │                  │  │                │  │    (RAG)    │ │
│  │  Planning        │  │  Redis pub/sub │  │             │ │
│  │  Discussion      │  │  + in-process  │  │  pgvector   │ │
│  │  Exec rounds     │  │  channels      │  │  cosine sim │ │
│  │  Peer consult    │  │                │  │  auto-embed │ │
│  │  Synthesis       │  └────────────────┘  └─────────────┘ │
│  │  QA review       │                                       │
│  │  Auto scheduler  │  ┌────────────────┐  ┌─────────────┐ │
│  └──────┬───────────┘  │  MCP Manager   │  │  Provider   │ │
│         │              │                │  │  Registry   │ │
│         │              │  stdio/SSE     │  │             │ │
│         │              │  session pool  │  │  LLM/embed/ │ │
│         │              │  tool dispatch │  │  image/audio│ │
│         │              └────────────────┘  └─────────────┘ │
└─────────┼───────────────────┬─────────────────────────────┘
          │                   │
     LLM / Image APIs    ┌────▼──────────────────────────────┐
  (OpenAI · Anthropic    │    MCP Servers (per-workforce)    │
   Google · Cloudflare   │  Aither-Tools: filesystem, shell, │
   fal.ai · LiteLLM      │  git, web, kanban, secrets, media │
   any OpenAI-compat)    │  + user-defined custom servers    │
                         └───────────────────────────────────┘
          │
┌─────────▼──────────────────┐   ┌───────────────────────────┐
│   PostgreSQL 16 + pgvector │   │        Redis 7+           │
│   Agents · Workforces      │   │   Execution event streams │
│   Executions · Messages    │   │   WebSocket fan-out       │
│   Knowledge · Kanban       │   │   Pub/sub coordination    │
└────────────────────────────┘   └───────────────────────────┘
```

### Execution lifecycle

```
Objective
    │
    ▼
[Planning]          leader agent decomposes into per-agent subtasks
    │
    ▼
[Discussion]        agents debate approach, reach consensus strategy
    │               (skipped for single-agent or media-only workforces)
    ▼
  Human approves strategy  ──► (or auto-approved)
    │
    ▼
[Execution Rounds]  coordinated round-robin subtask execution
    │    └──────────► [Peer Consultation]  agent asks peer mid-task
    │                                      peer responds, agent continues
    ▼
[Synthesis]         leader assembles final output from all subtask results
    │
    ▼
[QA Review]         LLM checks output against kanban task acceptance criteria
    │               passed → Done  /  flagged → Blocked for human review
    ▼
[Knowledge Ingest]  execution result + messages embedded into vector KB
```

**Go backend** — single binary, goroutine-per-execution concurrency model, context cancellation for clean shutdown, structured logging, graceful halt/resume.

**Next.js frontend** — server-side rendered with client-side WebSocket for real-time updates. No polling. Status transitions, tool calls, and agent messages stream directly to the browser.

**PostgreSQL + pgvector** — all persistent state in a single relational database. The `vector` extension enables cosine similarity search for knowledge retrieval without a separate vector database.

**Redis** — pub/sub event bus between orchestrator goroutines and WebSocket handlers. Also supports multi-instance deployments where execution events need to fan out across backend replicas.

**MCP (Model Context Protocol)** — each workforce runs its own Aither-Tools process over stdio. The MCP manager maintains the session, dispatches tool calls, and injects workforce-specific environment variables (workspace path, API token, workforce ID).

---

## Installation & Deployment

### Requirements

- Go 1.22+
- Node.js 20+
- PostgreSQL 16+ with the `pgvector` extension (`CREATE EXTENSION vector;`)
- Redis 7+
- An LLM provider (OpenAI, Anthropic via LiteLLM, Google, Cloudflare, or any OpenAI-compatible endpoint)
- PM2 (`npm install -g pm2`) — for production process management

---

### Installation

#### 1. Clone and configure

```bash
git clone https://github.com/AitherLabs/AitherOS.git /opt/AitherOS
cd /opt/AitherOS

# Backend environment
cp .env.example .env
# Fill in: DATABASE_URL, REDIS_URL, JWT_SECRET, ENCRYPTION_KEY,
#          SERVICE_TOKEN, LLM_API_BASE, LLM_API_KEY
# Set INSTALL_ROOT if you cloned to a different path (default: /opt/AitherOS)

# Frontend environment
cp frontend/.env.example frontend/.env.local
# Fill in: NEXTAUTH_URL, NEXTAUTH_SECRET, NEXT_PUBLIC_API_URL
```

Generate the required secrets:

```bash
# JWT_SECRET and SERVICE_TOKEN
openssl rand -hex 32

# ENCRYPTION_KEY and NEXTAUTH_SECRET
openssl rand -base64 32
```

#### 2. Database setup

```bash
# Create database and user
sudo -u postgres psql -c "CREATE USER aitheros WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE aitheros OWNER aitheros;"
sudo -u postgres psql -d aitheros -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Apply schema and all migrations
for f in scripts/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

#### 3. Build

```bash
# Backend
cd /opt/AitherOS/backend
go build -o bin/aitherd ./cmd/aitherd/

# Frontend
cd /opt/AitherOS/frontend
npm install
npm run build
```

#### 4. Aither-Tools MCP server

```bash
cd /opt/AitherOS/mcp-servers/aither-tools
npm install
npm run build
```

#### 5. Start with PM2

```bash
cd /opt/AitherOS
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # follow printed instructions to enable auto-start on reboot
```

The `ecosystem.config.js` starts the Go backend (with auto-build on restart) and the Next.js frontend. Logs: `pm2 logs`.

---

### Publishing with Cloudflare Tunnel (recommended)

Cloudflare Tunnel exposes your instance to the internet without opening firewall ports or configuring a reverse proxy. Requires a free Cloudflare account with a domain.

#### Install cloudflared

```bash
# Debian/Ubuntu
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared

cloudflared tunnel login
```

#### Create tunnels

```bash
cloudflared tunnel create aitheros
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: app.your-domain.com
    service: http://localhost:3000

  - hostname: api.your-domain.com
    service: http://localhost:8080

  - service: http_status:404
```

```bash
cloudflared tunnel route dns aitheros app.your-domain.com
cloudflared tunnel route dns aitheros api.your-domain.com

cloudflared service install
systemctl start cloudflared
```

Update your environment:

```bash
# .env
CORS_ORIGINS=https://app.your-domain.com

# frontend/.env.local
NEXTAUTH_URL=https://app.your-domain.com
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

#### Internal-only (LAN access)

Skip cloudflared. Access at `http://<server-ip>:3000`, set `NEXT_PUBLIC_API_URL=http://<server-ip>:8080`, update `CORS_ORIGINS` to match.

---

### Key Environment Variables

| Variable | Required | Description |
|---|---|---|
| `INSTALL_ROOT` | No | Path to AitherOS clone (default: `/opt/AitherOS`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | HS256 secret for session tokens (`openssl rand -hex 32`) |
| `ENCRYPTION_KEY` | Yes | AES-256 key for credential vault (`openssl rand -base64 32`) |
| `SERVICE_TOKEN` | Yes | Internal token for MCP→API calls (`openssl rand -hex 32`) |
| `LLM_API_BASE` | Yes | OpenAI-compatible LLM endpoint |
| `LLM_API_KEY` | Yes | API key for LLM provider |
| `EMBEDDING_API_BASE` | No | Embedding endpoint (enables knowledge base RAG) |
| `REGISTRATION_TOKEN` | No | Token required to register the first admin user |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins for the API |
| `NEXTAUTH_URL` | Yes | Frontend public URL (must match browser URL) |
| `NEXTAUTH_SECRET` | Yes | NextAuth session encryption secret |
| `NEXT_PUBLIC_API_URL` | Yes | Backend API URL (served to the browser) |

---

## Use Cases

### Research & Intelligence
Compose a researcher, an analyst, and a writer agent. The researcher uses web search and HTTP tools to gather sources; the analyst cross-references and synthesizes findings; the writer produces the final report. Long-term memory means the team retains everything it has learned across missions — ask the same team to update a report three months later and it already has context.

### Software Engineering
Architect, coder, reviewer, and tester agents with real shell access, git operations, and filesystem tools. The kanban board tracks features and bugs through the full development cycle. The architect decomposes work into kanban tasks; you approve them one by one; the autonomous loop runs each through a full development execution. QA review checks output against acceptance criteria before marking done.

### Creative Production
Art director, copywriter, and asset generator agents. The art director runs a planning execution that populates the kanban with every asset needed for a campaign — hero images, social cards, copy variants. You approve the task list. The autonomous loop runs each asset generation, checks the output, and routes failures back for review. Native image generation (Google Imagen, DALL-E, Cloudflare Flux.1) means no external tools needed.

### Data Operations
Extractor, transformer, and analyzer agents with network and shell tools. The credential vault stores API keys for data sources. Agents run ETL pipelines, generate reports, and write findings to the knowledge base for future reference.

### Enterprise Automation
Any multi-step business process that requires judgment, tool use, and human oversight at defined checkpoints. AitherOS provides the execution backbone, the audit trail (every message and tool call logged), and the intervention layer (halt, guide, resume at any point).

---

## Roadmap

- ✅ Multi-agent orchestration with peer consultation
- ✅ Long-term memory with pgvector RAG
- ✅ MCP tool layer (Aither-Tools, 50+ tools)
- ✅ Image generation (Google Imagen 4, DALL-E, Cloudflare Workers AI, fal.ai)
- ✅ Autonomous kanban loop with post-execution LLM QA review
- ✅ Cloudflare Workers AI provider with model catalog sync
- ✅ Deployment guide with Cloudflare Tunnel
- 🔜 **Virtual Office** — 2D workspace with agent sprites, real-time movement, speech bubbles
- 🔜 **Webhooks & external triggers** — start executions from Slack messages, GitHub events, cron schedules, or HTTP webhooks
- 🔜 **Execution templates** — save and replay workforce configurations, plans, and task sequences
- 🔜 **Agent marketplace** — community-published agent configurations and workforce blueprints
- 🔜 **Multi-tenant deployment** — isolated workspaces per organization on a shared infrastructure

---

## License

AitherOS is licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.

**What this means:**

- ✅ Free to use, modify, and self-host for personal projects and internal business use
- ✅ Free to build on and redistribute, as long as derivative works are also released under AGPLv3
- ✅ If you run AitherOS as a network service (SaaS), you must publish your full source code under AGPLv3 — this is the core copyleft provision of the AGPL
- ❌ You may **not** incorporate AitherOS into a proprietary product or service without a commercial license

**Commercial License:** Companies that want to build proprietary products on AitherOS, offer it as a managed service without open-sourcing their code, or embed it in commercial applications need a commercial license. Contact us at **[labs@aitheros.io](mailto:labs@aitheros.io)**.

See [LICENSE](./LICENSE) for the complete license text.

---

## Links

- **Website**: [aither.systems](https://aither.systems)
- **Issues & Discussions**: [github.com/AitherLabs/AitherOS/issues](https://github.com/AitherLabs/AitherOS/issues)
- **Releases**: [github.com/AitherLabs/AitherOS/releases](https://github.com/AitherLabs/AitherOS/releases)
- **Commercial licensing**: [labs@aitheros.io](mailto:labs@aitheros.io)

---

<div align="center">
  <sub>Built by <a href="https://aither.systems">AitherLabs</a> · Licensed under AGPLv3 · Commercial licenses available at labs@aitheros.io</sub>
</div>
