package api

import (
	"net/http"

	"github.com/aitheros/backend/internal/auth"
	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/eventbus"
	"github.com/aitheros/backend/internal/knowledge"
	"github.com/aitheros/backend/internal/mcp"
	"github.com/aitheros/backend/internal/orchestrator"
	"github.com/aitheros/backend/internal/store"
)

func NewRouter(s *store.Store, o *orchestrator.Orchestrator, eb *eventbus.EventBus, reg *engine.ProviderRegistry, jwtMgr *auth.JWTManager, km *knowledge.Manager, mcpMgr *mcp.Manager, corsOrigins string) http.Handler {
	mux := http.NewServeMux()

	agents := NewAgentHandler(s)
	workforces := NewWorkForceHandler(s)
	executions := NewExecutionHandler(s, o)
	ws := NewWebSocketHandler(eb, jwtMgr)
	providers := NewProviderHandler(s)
	debug := NewDebugHandler(s, reg, mcpMgr)
	mcp := NewMCPHandler(s)
	kb := NewKnowledgeHandler(s, km)
	approvals := NewApprovalHandler(s)
	activity := NewActivityHandler(s)
	agentChat := NewAgentChatHandler(s, km)
	upload := NewUploadHandler()

	// Health (public)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// ── Auth (public) ──────────────────────────────────────
	if jwtMgr != nil {
		authH := NewAuthHandler(s, jwtMgr)
		mux.HandleFunc("POST /api/v1/auth/register", authH.Register)
		mux.HandleFunc("POST /api/v1/auth/login", authH.Login)
		mux.HandleFunc("GET /api/v1/auth/me", authH.Me)
		mux.HandleFunc("PATCH /api/v1/auth/me", authH.UpdateMe)
	}

	// ── Protected API routes ───────────────────────────────

	// Agents CRUD
	mux.HandleFunc("POST /api/v1/agents", agents.Create)
	mux.HandleFunc("GET /api/v1/agents", agents.List)
	mux.HandleFunc("GET /api/v1/agents/{id}", agents.Get)
	mux.HandleFunc("PATCH /api/v1/agents/{id}", agents.Update)
	mux.HandleFunc("DELETE /api/v1/agents/{id}", agents.Delete)

	// Agent Debug (single-agent test / preview)
	mux.HandleFunc("POST /api/v1/agents/{id}/debug", debug.Debug)

	// Agent Chat History (persistent DB storage, replaces localStorage)
	mux.HandleFunc("GET /api/v1/agents/{id}/chats", agentChat.List)
	mux.HandleFunc("POST /api/v1/agents/{id}/chats", agentChat.Create)
	mux.HandleFunc("DELETE /api/v1/agents/{id}/chats", agentChat.Clear)

	// Model Providers CRUD
	mux.HandleFunc("GET /api/v1/providers/schemas", providers.Schemas)
	mux.HandleFunc("POST /api/v1/providers", providers.Create)
	mux.HandleFunc("GET /api/v1/providers", providers.List)
	mux.HandleFunc("GET /api/v1/providers/{id}", providers.Get)
	mux.HandleFunc("PATCH /api/v1/providers/{id}", providers.Update)
	mux.HandleFunc("DELETE /api/v1/providers/{id}", providers.Delete)
	mux.HandleFunc("POST /api/v1/providers/{id}/models", providers.AddModel)
	mux.HandleFunc("DELETE /api/v1/providers/{id}/models/{modelID}", providers.RemoveModel)

	// WorkForces CRUD
	mux.HandleFunc("POST /api/v1/workforces", workforces.Create)
	mux.HandleFunc("GET /api/v1/workforces", workforces.List)
	mux.HandleFunc("GET /api/v1/workforces/{id}", workforces.Get)
	mux.HandleFunc("PATCH /api/v1/workforces/{id}", workforces.Update)
	mux.HandleFunc("DELETE /api/v1/workforces/{id}", workforces.Delete)

	// Executions
	mux.HandleFunc("POST /api/v1/workforces/{id}/executions", executions.Start)
	mux.HandleFunc("GET /api/v1/workforces/{id}/executions", executions.List)
	mux.HandleFunc("GET /api/v1/workforces/{id}/executions/{execID}", executions.Get)
	mux.HandleFunc("GET /api/v1/executions/{execID}", executions.GetDirect)
	mux.HandleFunc("POST /api/v1/executions/{execID}/approve", executions.Approve)
	mux.HandleFunc("POST /api/v1/executions/{execID}/halt", executions.Halt)
	mux.HandleFunc("POST /api/v1/executions/{execID}/resume", executions.Resume)
	mux.HandleFunc("POST /api/v1/executions/{execID}/intervene", executions.Intervene)
	mux.HandleFunc("PATCH /api/v1/executions/{execID}/meta", executions.UpdateMeta)
	mux.HandleFunc("DELETE /api/v1/executions/{execID}", executions.Delete)
	mux.HandleFunc("GET /api/v1/executions/{execID}/messages", executions.Messages)
	mux.HandleFunc("GET /api/v1/workforces/{id}/preflight", executions.Preflight)
	mux.HandleFunc("GET /api/v1/executions/{execID}/discussion", executions.DiscussionMessages)
	mux.HandleFunc("GET /api/v1/executions/{execID}/review", executions.ReviewMessages)
	mux.HandleFunc("POST /api/v1/executions/{execID}/qa", executions.AskQA)
	mux.HandleFunc("GET /api/v1/executions/{execID}/qa", executions.ListQA)

	// File uploads
	mux.HandleFunc("POST /api/v1/upload", upload.Upload)
	uploadFS := http.StripPrefix("/uploads/", http.FileServer(http.Dir("/opt/AitherOS/uploads")))
	mux.Handle("GET /uploads/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		w.Header().Set("X-Frame-Options", "DENY")
		uploadFS.ServeHTTP(w, r)
	}))

	// WebSocket
	mux.HandleFunc("GET /ws/executions/{execID}", ws.ServeWS)

	// MCP Servers CRUD
	mux.HandleFunc("POST /api/v1/mcp/servers", mcp.CreateServer)
	mux.HandleFunc("GET /api/v1/mcp/servers", mcp.ListServers)
	mux.HandleFunc("GET /api/v1/mcp/servers/{id}", mcp.GetServer)
	mux.HandleFunc("PATCH /api/v1/mcp/servers/{id}", mcp.UpdateServer)
	mux.HandleFunc("DELETE /api/v1/mcp/servers/{id}", mcp.DeleteServer)
	mux.HandleFunc("GET /api/v1/mcp/servers/{id}/tools", mcp.ListServerTools)
	mux.HandleFunc("POST /api/v1/mcp/servers/{id}/discover", mcp.DiscoverTools)

	// Workforce ↔ MCP Server mapping
	mux.HandleFunc("GET /api/v1/workforces/{id}/mcp", mcp.ListWorkforceServers)
	mux.HandleFunc("POST /api/v1/workforces/{id}/mcp", mcp.AttachToWorkforce)
	mux.HandleFunc("DELETE /api/v1/workforces/{id}/mcp/{serverID}", mcp.DetachFromWorkforce)

	// Agent tool permissions
	mux.HandleFunc("POST /api/v1/mcp/agent-tools", mcp.SetAgentTools)
	mux.HandleFunc("GET /api/v1/mcp/agent-tools/{agentID}/{serverID}", mcp.GetAgentTools)
	mux.HandleFunc("DELETE /api/v1/mcp/agent-tools/{agentID}/{serverID}", mcp.RemoveAgentTools)

	// Approvals
	mux.HandleFunc("POST /api/v1/workforces/{id}/approvals", approvals.Create)
	mux.HandleFunc("GET /api/v1/workforces/{id}/approvals", approvals.List)
	mux.HandleFunc("GET /api/v1/workforces/{id}/approvals/pending-count", approvals.CountPending)
	mux.HandleFunc("GET /api/v1/approvals/{approvalID}", approvals.Get)
	mux.HandleFunc("POST /api/v1/approvals/{approvalID}/resolve", approvals.Resolve)

	// Activity Events
	mux.HandleFunc("GET /api/v1/activity", activity.ListGlobal)
	mux.HandleFunc("GET /api/v1/workforces/{id}/activity", activity.List)

	// Knowledge Base
	mux.HandleFunc("GET /api/v1/workforces/{id}/knowledge", kb.List)
	mux.HandleFunc("POST /api/v1/workforces/{id}/knowledge", kb.Create)
	mux.HandleFunc("POST /api/v1/workforces/{id}/knowledge/search", kb.Search)
	mux.HandleFunc("GET /api/v1/workforces/{id}/knowledge/count", kb.Count)
	mux.HandleFunc("DELETE /api/v1/workforces/{id}/knowledge/{entryID}", kb.Delete)

	// Apply middleware stack
	var handler http.Handler = mux
	// Auth: use OptionalMiddleware for now (beta) — validates token if present, doesn't block if absent.
	// Switch to auth.Middleware(jwtMgr) for strict enforcement when ready.
	if jwtMgr != nil {
		handler = auth.OptionalMiddleware(jwtMgr)(handler)
	}
	handler = CORSMiddleware(corsOrigins)(handler)
	handler = LoggingMiddleware(handler)

	return handler
}
