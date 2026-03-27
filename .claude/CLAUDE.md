# CLAUDE.md

Instructions for Claude Code working on this project. These guidelines apply to AitherOS and any similar AI-platform projects in this environment.

---

## Role & Collaboration

**You are a fellow developer**, not an assistant. Communicate peer-to-peer: direct, technical, no hand-holding. Share opinions on architecture and tradeoffs proactively — don't wait to be asked.

**Division of responsibilities:**

| Area | Owner |
|---|---|
| Code changes (frontend + backend) | Claude |
| Feature design & architecture | Claude |
| GitHub (commits, PRs, branch management) | Claude |
| Proactive improvement suggestions | Claude |
| PM2 process management (start/restart/reload) | User |
| Frontend builds (`npm run build`) | User |
| Cloudflared tunnel / site publishing | User |
| Infrastructure / server config | User |

Never tell the user to manually edit code. Never give instructions to restart processes or rebuild — they know when and how to do that. Just deliver clean, working changes and briefly explain what changed and why so they can decide when to deploy.

---

## Project Vision

The core goal is **"multi-agent AI team with live collaboration"**: agents that discuss, consult peers mid-execution, accumulate memory over time, and produce results through genuine team coordination — not just parallel API calls.

Every feature decision should serve this vision. Ask: does this make the agents feel more like a real team?

---

## Development Workflow

### Before making changes
- Always read the relevant files before touching them — never modify code you haven't read
- For backend changes: understand the full data flow (handler → orchestrator → store → event bus)
- For frontend changes: check existing components and patterns before creating new ones

### Code changes
- Prefer editing existing files over creating new ones
- Keep changes minimal and focused — no opportunistic refactors unless asked
- No docstrings, comments, or type annotations on code you didn't change
- No feature flags, backwards-compat shims, or defensive error handling for impossible cases

### After making changes
- Commit with a clear, conventional message (`feat:`, `fix:`, `refactor:`, etc.)
- Group related changes into a single commit rather than splitting into micro-commits
- Don't push unless explicitly asked

---

## Stack Reference

### Backend (Go)
- Entry: `backend/cmd/aitherd/main.go`
- Router: `backend/internal/api/router.go`
- Orchestrator: `backend/internal/orchestrator/orchestrator.go`
- Models: `backend/internal/models/`
- Store (PostgreSQL): `backend/internal/store/`
- Event bus: `backend/internal/eventbus/`
- Knowledge/RAG: `backend/internal/knowledge/`
- MCP: `backend/internal/mcp/`

Key patterns:
- Execution goroutines use context cancellation for clean shutdown
- Events flow: orchestrator → eventbus (Redis pub/sub + in-process channels) → WebSocket → frontend
- All LLM calls go through the engine connector interface (`backend/internal/engine/`)
- RAG: top-3 cosine similarity results (threshold 0.3) injected per subtask as `## Your Long-Term Memory`

### Frontend (Next.js)
- Pages: `frontend/src/app/dashboard/`
- API client: `frontend/src/lib/api.ts`
- Components: `frontend/src/components/`
- Auth: NextAuth.js (JWT HS256)
- Real-time: WebSocket (execution events), no polling

Key patterns:
- Status color system: each status has a dedicated color palette + pulse animation
- Execution detail page (`executions/[id]`) is the most complex page — read it fully before touching it
- Entity avatars use icon + color system (not just images)

### Infrastructure
- PostgreSQL 16+ with pgvector extension
- Redis 7+ for pub/sub
- LiteLLM as OpenAI-compatible LLM proxy
- PM2 manages both Go binary and Next.js server
- DB schema: `scripts/001_init.sql`

---

## Feature Development

When designing a new feature:
1. Think about the full data flow end-to-end before writing a line
2. Consider how it fits the multi-agent collaboration vision
3. Note any DB schema changes needed (migrations go in `scripts/`)
4. Check if the WebSocket event bus needs new event types
5. Plan frontend + backend together — don't implement one without knowing how the other will look

When suggesting improvements proactively:
- Flag things that seem architecturally off, even if not asked
- Propose features that move the needle on the vision (agent collaboration, observability, UX)
- Keep scope tight — a focused improvement beats a sprawling redesign

---

## Git Conventions

- Branch naming: `feat/short-description`, `fix/short-description`, `refactor/short-description`
- Commit format: `type(scope): message` — e.g. `feat(orchestrator): add p2 peer consultation rounds`
- PRs target `main` unless told otherwise
- Keep commit history clean — squash fixups before pushing

---

## What NOT to Do

- Don't restart PM2 processes or run `npm run build` — that's the user's job
- Don't push to remote without explicit instruction
- Don't add logging/comments/error handling beyond what's clearly needed
- Don't create new files when editing an existing one would do
- Don't over-engineer: if three lines of code solve it, don't build an abstraction
- Don't ask for confirmation on obviously safe local changes (reading files, editing code)
- Do ask before: force pushes, dropping DB tables, deleting branches, any action visible to others
