# Contributing to AitherOS

Thank you for your interest in contributing. AitherOS is an open-source multi-agent AI platform and we welcome contributions of all kinds — bug fixes, new features, documentation improvements, and more.

## Before You Start

- Read the [README](./README.md) to understand the project architecture
- Check the [open issues](https://github.com/AitherLabs/AitherOS/issues) to avoid duplicating work
- For large changes, open an issue first to discuss the approach before writing code

## Development Setup

### Requirements

- Go 1.22+
- Node.js 20+
- PostgreSQL 16+ with pgvector extension
- Redis 7+

### Running Locally

```bash
git clone https://github.com/AitherLabs/AitherOS.git /opt/AitherOS
cd /opt/AitherOS

# Backend
cd backend && go build ./cmd/aitherd/... && cd ..

# Frontend
cd frontend && npm install && npm run build && cd ..

# Database
psql -U postgres -f scripts/001_init.sql
```

See the full [self-hosting guide](./README.md#self-hosting) for environment variables and infrastructure setup.

## How to Contribute

### Reporting Bugs

Use the [Bug Report template](https://github.com/AitherLabs/AitherOS/issues/new?template=bug_report.md). Include:

- Steps to reproduce
- Expected vs actual behavior
- Relevant logs or screenshots
- Go/Node versions and OS

### Suggesting Features

Use the [Feature Request template](https://github.com/AitherLabs/AitherOS/issues/new?template=feature_request.md). Frame your suggestion in terms of the project vision: does it make the agent team feel more real and collaborative?

### Submitting a Pull Request

1. Fork the repository and create a branch: `feat/your-feature` or `fix/your-bug`
2. Make your changes following the code style below
3. Build and test locally before opening a PR
4. Fill in the PR template — describe what changed and why
5. PRs target `main`

## Code Style

### Backend (Go)

- Follow standard Go conventions (`gofmt`, `go vet`)
- Keep functions focused — if it does two things, split it
- No unnecessary abstractions — three lines of code beats a helper used once
- Error messages: lowercase, no trailing period, wrap with `fmt.Errorf("context: %w", err)`

### Frontend (TypeScript / Next.js)

- Functional components with hooks
- Keep components focused — extract only when reused in 2+ places
- No new dependencies without discussion — check if the stdlib or an existing package covers it

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(orchestrator): add peer consultation rounds
fix(engine): correct Cloudflare prompt truncation
refactor(store): simplify kanban query
docs(readme): update self-hosting guide
```

Group related changes into one commit. Squash fixups before opening the PR.

## Architecture Overview

```
backend/
  cmd/aitherd/        # Entry point
  internal/
    api/              # HTTP handlers and router
    orchestrator/     # Execution engine, agent coordination
    engine/           # LLM connector interface
    store/            # PostgreSQL queries
    eventbus/         # Redis pub/sub + WebSocket bridge
    mcp/              # Model Context Protocol tool layer
    knowledge/        # RAG / pgvector

frontend/
  src/
    app/dashboard/    # Next.js pages
    components/       # Shared UI components
    lib/api.ts        # API client
```

Data flow: `HTTP handler → orchestrator → engine connector → LLM → eventbus → WebSocket → frontend`

## What We're Looking For

Contributions that serve the core vision — a multi-agent team that feels genuinely collaborative:

- Agent coordination improvements (peer consultation, shared memory)
- New LLM provider connectors
- MCP tool integrations
- Observability and execution tracing
- UI/UX improvements to execution and kanban views
- Performance improvements to the event bus or store layer

## License

By contributing, you agree that your contributions will be licensed under the [GNU AGPLv3](./LICENSE).
