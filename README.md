<div align="center">
  <img src="frontend/public/assets/favicon.png" alt="AitherOS" width="80" />

  <h1>AitherOS</h1>

  <p><strong>The Operating System for Autonomous AI Teams</strong></p>

  <p>
    <a href="https://github.com/AitherLabs/AitherOS/releases"><img src="https://img.shields.io/github/v/release/AitherLabs/AitherOS?color=9A66FF&label=version&style=flat-square" alt="Version" /></a>
    <img src="https://img.shields.io/badge/self--hosted-yes-56D090?style=flat-square" alt="Self-hosted" />
    <img src="https://img.shields.io/badge/stack-Go%20%2B%20Next.js-FFBF47?style=flat-square" alt="Stack" />
    <img src="https://img.shields.io/badge/real--time-WebSocket-14FFF7?style=flat-square" alt="Real-time" />
  </p>
</div>

---

AitherOS lets you build and run **autonomous AI teams** — not just chatbots, not just API wrappers. Real teams of specialized agents that plan together, share memory, use tools, and produce results through genuine coordination.

You define the team. They do the work.

---

## What it looks like

**The Floor** — a live virtual workspace showing every agent, what they're doing right now, and how they're connecting to each other. Not a log viewer. Not a dashboard full of charts. A room you can walk into and read at a glance.

**Workforces** — groups of agents with shared goals, shared tools, and shared memory. Each workforce gets its own isolated workspace, credential vault, task board, and knowledge base. Everything a real team needs.

**Executions** — missions with a planning phase, coordinated agent rounds, peer consultation, and a synthesis step. The orchestrator drives the agents; you watch it unfold in real time. Step in when you need to, let it run when you don't.

---

## Core Capabilities

### Multi-Agent Orchestration
Agents operate in coordinated rounds with a shared plan. The orchestrator handles scheduling, token budgets, deadlock detection, and synthesis — so agents can focus on their specialization instead of workflow management.

### Long-Term Memory
Every execution writes to a per-workforce vector knowledge base. The next time an agent runs, it draws on everything the team has learned. Memory compounds. Teams get smarter over time.

### MCP Tool Ecosystem
Every workforce ships with **Aither-Tools** — a built-in MCP server with 50+ tools covering filesystem, shell, git, web search, networking, secrets, kanban, and image generation. Add your own MCP servers alongside it. All provisioned automatically when a workforce is created.

### Image Generation
Agents can generate images natively — not by switching models, but by calling a `generate_image` tool that works with Google Imagen, OpenAI DALL-E, fal.ai, or any compatible provider. The orchestrator injects credentials from your provider configuration automatically.

### Real-Time Collaboration
The frontend connects via WebSocket. Every agent message, tool call, and status change appears live. Human-in-the-loop intervention — guidance, corrections, halts — is a first-class feature, not an afterthought.

### Secure Credential Vault
Per-workforce AES-256-GCM encrypted secrets. Agents access credentials through the `get_secret` tool at runtime — no hardcoded keys, no shared environment variables leaking across teams.

### Provider Flexibility
Connect any LLM provider through an OpenAI-compatible interface. Mix models within a single workforce — one agent on GPT-4o, another on Claude 3.5, a third on a local Mistral. Supports text, embedding, image, video, and audio model types.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Frontend                    │
│         Next.js · WebSocket · Real-time      │
└───────────────────┬─────────────────────────┘
                    │ HTTP + WebSocket
┌───────────────────▼─────────────────────────┐
│                  Backend (Go)                │
│  Orchestrator · Event Bus · Knowledge (RAG)  │
│  MCP Manager · Provider Registry · Store     │
└──────┬──────────────┬───────────────┬────────┘
       │              │               │
  PostgreSQL       Redis           MCP Servers
  + pgvector      pub/sub         (Aither-Tools
                                   + custom)
```

**Go backend** — orchestrator, API, event bus, RAG pipeline, MCP session management
**Next.js frontend** — live execution view, workforce management, agent debug console
**PostgreSQL + pgvector** — persistent state + vector similarity search for knowledge retrieval
**Redis** — real-time event pub/sub between orchestrator goroutines and WebSocket connections
**MCP (Model Context Protocol)** — tool layer; every workforce runs its own isolated tool server

---

## Self-Hosting

### Requirements

- Go 1.22+
- Node.js 20+
- PostgreSQL 16+ with the `pgvector` extension (`CREATE EXTENSION vector;`)
- Redis 7+
- An LLM provider (OpenAI, Anthropic, Google, LiteLLM, or any OpenAI-compatible endpoint)
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

Cloudflare Tunnel lets you expose your self-hosted instance to the internet without opening firewall ports or setting up a reverse proxy. You need a free Cloudflare account with a domain.

#### Install cloudflared

```bash
# Debian/Ubuntu
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared

# Authenticate with your Cloudflare account
cloudflared tunnel login
```

#### Create tunnels

```bash
# Create a tunnel (once)
cloudflared tunnel create aitheros

# Configure routing: create /etc/cloudflared/config.yml
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<your-tunnel-id>.json

ingress:
  # Frontend (Next.js — port 3000)
  - hostname: app.your-domain.com
    service: http://localhost:3000

  # Backend API (Go — port 8080)
  - hostname: api.your-domain.com
    service: http://localhost:8080

  - service: http_status:404
```

```bash
# Create DNS records
cloudflared tunnel route dns aitheros app.your-domain.com
cloudflared tunnel route dns aitheros api.your-domain.com

# Install as a system service (starts on boot)
cloudflared service install
systemctl start cloudflared
```

Then update your environment:

```bash
# .env
CORS_ORIGINS=https://app.your-domain.com

# frontend/.env.local
NEXTAUTH_URL=https://app.your-domain.com
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

Rebuild the frontend and reload PM2 after updating env files.

#### Internal-only (no public domain)

For private installs accessible only on your LAN, skip cloudflared. Access the frontend at `http://<server-ip>:3000` and set `NEXT_PUBLIC_API_URL=http://<server-ip>:8080`. Update `CORS_ORIGINS` to match.

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
| `NEXT_PUBLIC_API_URL` | Yes | Backend API URL (served to browser) |

---

## What Teams Are Already Doing With It

- **Research teams** — agents that search, read, synthesize, and write reports across dozens of sources in parallel
- **Development squads** — planner, coder, reviewer, and tester agents that iterate on a codebase autonomously
- **Content studios** — writer, art director, and asset generator agents that produce campaigns end to end, including generated images
- **Data pipelines** — extract, transform, analyze, and summarize data from live sources
- **Support operations** — agents that triage, investigate, and draft responses with access to internal knowledge bases

---

## Roadmap

- **Virtual Office** — Gather.town-style 2D workspace where agent sprites move between rooms, animate when active, and show conversations as speech bubbles
- **Scheduled executions** — Autonomous mode with cron-triggered leadership reviews and recurring missions
- **Agent-to-agent messaging** — Direct peer consultation channels outside of execution rounds
- **Execution templates** — Save and reuse workforce configurations, plans, and playbooks
- **Webhooks & triggers** — Start executions from external events, Slack messages, or API calls

---

## Links

- **Website**: [aitheros.io](https://aitheros.io)
- **Issues**: [github.com/AitherLabs/AitherOS/issues](https://github.com/AitherLabs/AitherOS/issues)
- **Releases**: [github.com/AitherLabs/AitherOS/releases](https://github.com/AitherLabs/AitherOS/releases)

---

<div align="center">
  <sub>Built by <a href="https://aitheros.io">AitherLabs</a> · Self-hosted · Open Source</sub>
</div>
