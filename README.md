# AitherOS — Autonomous AI Workforce Platform

> Orchestrate multi-agent AI teams with real-time collaboration, human-in-the-loop control, and MCP tool integration.

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
