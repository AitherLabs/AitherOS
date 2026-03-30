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
	"github.com/aitheros/backend/internal/workspace"
)

func NewRouter(s *store.Store, o *orchestrator.Orchestrator, eb *eventbus.EventBus, reg *engine.ProviderRegistry, jwtMgr *auth.JWTManager, km *knowledge.Manager, mcpMgr *mcp.Manager, corsOrigins string, registrationToken string, serviceToken string) http.Handler {
	mux := http.NewServeMux()

	agents := NewAgentHandler(s)
	workforces := NewWorkForceHandler(s, workspace.NewProvisioner(s))
	executions := NewExecutionHandler(s, o)
	ws := NewWebSocketHandler(eb, jwtMgr)
	providers := NewProviderHandler(s)
	debug := NewDebugHandler(s, reg, mcpMgr)
	mcp := NewMCPHandler(s)
	kb := NewKnowledgeHandler(s, km)
	approvals := NewApprovalHandler(s)
	kanban := NewKanbanHandler(s)
	projects := NewProjectHandler(s, o)
	creds := NewCredentialHandler(s)
	activity := NewActivityHandler(s)
	agentChat := NewAgentChatHandler(s, km)
	upload := NewUploadHandler()
	skills := NewSkillHandler(s)

	// protect wraps a handler with JWT enforcement (no-op if jwtMgr is nil).
	// Requests bearing the SERVICE_TOKEN bypass JWT — used by Aither-Tools
	// for internal API calls (knowledge writes, kanban updates, etc.).
	protect := func(h http.Handler) http.Handler { return h }
	adminOnly := func(h http.Handler) http.Handler { return h }
	if jwtMgr != nil {
		jwtMiddleware := auth.Middleware(jwtMgr)
		protect = func(h http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if serviceToken != "" {
					if bearer := r.Header.Get("Authorization"); bearer == "Bearer "+serviceToken {
						h.ServeHTTP(w, r)
						return
					}
				}
				jwtMiddleware(h).ServeHTTP(w, r)
			})
		}
		adminOnly = auth.AdminMiddleware(jwtMgr)
	}

	// Health (public)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// ── Auth (public) ──────────────────────────────────────
	if jwtMgr != nil {
		authH := NewAuthHandler(s, jwtMgr, registrationToken)
		mux.HandleFunc("POST /api/v1/auth/register", authH.Register)
		mux.HandleFunc("POST /api/v1/auth/login", authH.Login)
		mux.Handle("GET /api/v1/auth/me", protect(http.HandlerFunc(authH.Me)))
		mux.Handle("PATCH /api/v1/auth/me", protect(http.HandlerFunc(authH.UpdateMe)))

		// ── Admin (admin role required) ────────────────────
		mux.Handle("GET /api/v1/admin/users", adminOnly(http.HandlerFunc(authH.AdminListUsers)))
		mux.Handle("POST /api/v1/admin/users", adminOnly(http.HandlerFunc(authH.AdminCreateUser)))
		mux.Handle("PATCH /api/v1/admin/users/{id}/active", adminOnly(http.HandlerFunc(authH.AdminSetUserActive)))
	}

	// ── Protected API routes ───────────────────────────────

	// Agents CRUD
	mux.Handle("POST /api/v1/agents", protect(http.HandlerFunc(agents.Create)))
	mux.Handle("GET /api/v1/agents", protect(http.HandlerFunc(agents.List)))
	mux.Handle("GET /api/v1/agents/{id}", protect(http.HandlerFunc(agents.Get)))
	mux.Handle("PATCH /api/v1/agents/{id}", protect(http.HandlerFunc(agents.Update)))
	mux.Handle("DELETE /api/v1/agents/{id}", protect(http.HandlerFunc(agents.Delete)))

	// Agent Debug (single-agent test / preview)
	mux.Handle("POST /api/v1/agents/{id}/debug", protect(http.HandlerFunc(debug.Debug)))

	// Agent Chat History
	mux.Handle("GET /api/v1/agents/{id}/chats", protect(http.HandlerFunc(agentChat.List)))
	mux.Handle("POST /api/v1/agents/{id}/chats", protect(http.HandlerFunc(agentChat.Create)))
	mux.Handle("DELETE /api/v1/agents/{id}/chats", protect(http.HandlerFunc(agentChat.Clear)))

	// Model Providers CRUD
	mux.Handle("GET /api/v1/providers/schemas", protect(http.HandlerFunc(providers.Schemas)))
	mux.Handle("POST /api/v1/providers/test", protect(http.HandlerFunc(providers.TestConnection)))
	mux.Handle("POST /api/v1/providers", protect(http.HandlerFunc(providers.Create)))
	mux.Handle("GET /api/v1/providers", protect(http.HandlerFunc(providers.List)))
	mux.Handle("GET /api/v1/providers/{id}", protect(http.HandlerFunc(providers.Get)))
	mux.Handle("PATCH /api/v1/providers/{id}", protect(http.HandlerFunc(providers.Update)))
	mux.Handle("DELETE /api/v1/providers/{id}", protect(http.HandlerFunc(providers.Delete)))
	mux.Handle("POST /api/v1/providers/{id}/models", protect(http.HandlerFunc(providers.AddModel)))
	mux.Handle("DELETE /api/v1/providers/{id}/models/{modelID}", protect(http.HandlerFunc(providers.RemoveModel)))
	mux.Handle("GET /api/v1/providers/{id}/live-models", protect(http.HandlerFunc(providers.ProbeModels)))

	// WorkForces CRUD
	mux.Handle("POST /api/v1/workforces", protect(http.HandlerFunc(workforces.Create)))
	mux.Handle("GET /api/v1/workforces", protect(http.HandlerFunc(workforces.List)))
	mux.Handle("GET /api/v1/workforces/{id}", protect(http.HandlerFunc(workforces.Get)))
	mux.Handle("PATCH /api/v1/workforces/{id}", protect(http.HandlerFunc(workforces.Update)))
	mux.Handle("DELETE /api/v1/workforces/{id}", protect(http.HandlerFunc(workforces.Delete)))
	mux.Handle("POST /api/v1/workforces/{id}/provision", protect(http.HandlerFunc(workforces.Provision)))
	mux.Handle("GET /api/v1/workforces/{id}/files", protect(http.HandlerFunc(workforces.File)))

	// Global stats
	mux.Handle("GET /api/v1/stats", protect(http.HandlerFunc(executions.GlobalStats)))
	mux.Handle("GET /api/v1/stats/tokens", protect(http.HandlerFunc(executions.TokenBreakdown)))

	// Executions
	mux.Handle("GET /api/v1/executions", protect(http.HandlerFunc(executions.ListAll)))
	mux.Handle("POST /api/v1/workforces/{id}/executions", protect(http.HandlerFunc(executions.Start)))
	mux.Handle("GET /api/v1/workforces/{id}/executions", protect(http.HandlerFunc(executions.List)))
	mux.Handle("GET /api/v1/workforces/{id}/executions/{execID}", protect(http.HandlerFunc(executions.Get)))
	mux.Handle("GET /api/v1/executions/{execID}", protect(http.HandlerFunc(executions.GetDirect)))
	mux.Handle("POST /api/v1/executions/{execID}/approve", protect(http.HandlerFunc(executions.Approve)))
	mux.Handle("POST /api/v1/executions/{execID}/halt", protect(http.HandlerFunc(executions.Halt)))
	mux.Handle("POST /api/v1/executions/{execID}/resume", protect(http.HandlerFunc(executions.Resume)))
	mux.Handle("POST /api/v1/executions/{execID}/intervene", protect(http.HandlerFunc(executions.Intervene)))
	mux.Handle("PATCH /api/v1/executions/{execID}/meta", protect(http.HandlerFunc(executions.UpdateMeta)))
	mux.Handle("DELETE /api/v1/executions/{execID}", protect(http.HandlerFunc(executions.Delete)))
	mux.Handle("GET /api/v1/executions/{execID}/messages", protect(http.HandlerFunc(executions.Messages)))
	mux.Handle("GET /api/v1/workforces/{id}/preflight", protect(http.HandlerFunc(executions.Preflight)))
	mux.Handle("GET /api/v1/executions/{execID}/discussion", protect(http.HandlerFunc(executions.DiscussionMessages)))
	mux.Handle("GET /api/v1/executions/{execID}/review", protect(http.HandlerFunc(executions.ReviewMessages)))
	mux.Handle("POST /api/v1/executions/{execID}/qa", protect(http.HandlerFunc(executions.AskQA)))
	mux.Handle("GET /api/v1/executions/{execID}/qa", protect(http.HandlerFunc(executions.ListQA)))
	mux.Handle("POST /api/v1/executions/{execID}/chat", protect(http.HandlerFunc(executions.Chat)))
	mux.Handle("GET /api/v1/executions/{execID}/events", protect(http.HandlerFunc(executions.Events)))

	// File uploads
	mux.Handle("POST /api/v1/upload", protect(http.HandlerFunc(upload.Upload)))
	uploadFS := http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadDir)))
	mux.Handle("GET /uploads/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		w.Header().Set("X-Frame-Options", "DENY")
		uploadFS.ServeHTTP(w, r)
	}))

	// WebSocket — auth handled per-connection inside handler
	mux.HandleFunc("GET /ws/executions/{execID}", ws.ServeWS)

	// MCP Servers CRUD
	mux.Handle("POST /api/v1/mcp/servers", protect(http.HandlerFunc(mcp.CreateServer)))
	mux.Handle("GET /api/v1/mcp/servers", protect(http.HandlerFunc(mcp.ListServers)))
	mux.Handle("GET /api/v1/mcp/servers/{id}", protect(http.HandlerFunc(mcp.GetServer)))
	mux.Handle("PATCH /api/v1/mcp/servers/{id}", protect(http.HandlerFunc(mcp.UpdateServer)))
	mux.Handle("DELETE /api/v1/mcp/servers/{id}", protect(http.HandlerFunc(mcp.DeleteServer)))
	mux.Handle("GET /api/v1/mcp/servers/{id}/tools", protect(http.HandlerFunc(mcp.ListServerTools)))
	mux.Handle("POST /api/v1/mcp/servers/{id}/discover", protect(http.HandlerFunc(mcp.DiscoverTools)))

	// Workforce ↔ MCP Server mapping
	mux.Handle("GET /api/v1/workforces/{id}/mcp", protect(http.HandlerFunc(mcp.ListWorkforceServers)))
	mux.Handle("POST /api/v1/workforces/{id}/mcp", protect(http.HandlerFunc(mcp.AttachToWorkforce)))
	mux.Handle("DELETE /api/v1/workforces/{id}/mcp/{serverID}", protect(http.HandlerFunc(mcp.DetachFromWorkforce)))

	// Agent tool permissions
	mux.Handle("GET /api/v1/agents/{agentID}/mcp-servers", protect(http.HandlerFunc(mcp.ListAgentServersWithTools)))
	mux.Handle("POST /api/v1/mcp/agent-tools", protect(http.HandlerFunc(mcp.SetAgentTools)))
	mux.Handle("GET /api/v1/mcp/agent-tools/{agentID}/{serverID}", protect(http.HandlerFunc(mcp.GetAgentTools)))
	mux.Handle("DELETE /api/v1/mcp/agent-tools/{agentID}/{serverID}", protect(http.HandlerFunc(mcp.RemoveAgentTools)))

	// Credentials (per-workforce, per-service secrets)
	mux.Handle("GET /api/v1/workforces/{id}/credentials", protect(http.HandlerFunc(creds.List)))
	mux.Handle("PUT /api/v1/workforces/{id}/credentials", protect(http.HandlerFunc(creds.Upsert)))
	mux.Handle("DELETE /api/v1/workforces/{id}/credentials/{service}/{keyName}", protect(http.HandlerFunc(creds.Delete)))

	// Kanban
	mux.Handle("GET /api/v1/workforces/{id}/kanban", protect(http.HandlerFunc(kanban.List)))
	mux.Handle("POST /api/v1/workforces/{id}/kanban", protect(http.HandlerFunc(kanban.Create)))
	mux.Handle("PATCH /api/v1/kanban/{taskID}", protect(http.HandlerFunc(kanban.Update)))
	mux.Handle("DELETE /api/v1/kanban/{taskID}", protect(http.HandlerFunc(kanban.Delete)))

	// Projects
	mux.Handle("GET /api/v1/workforces/{id}/projects", protect(http.HandlerFunc(projects.List)))
	mux.Handle("POST /api/v1/workforces/{id}/projects", protect(http.HandlerFunc(projects.Create)))
	mux.Handle("GET /api/v1/projects/{projectID}", protect(http.HandlerFunc(projects.Get)))
	mux.Handle("PATCH /api/v1/projects/{projectID}", protect(http.HandlerFunc(projects.Update)))
	mux.Handle("DELETE /api/v1/projects/{projectID}", protect(http.HandlerFunc(projects.Delete)))
	mux.Handle("POST /api/v1/projects/{projectID}/brief/refresh", protect(http.HandlerFunc(projects.RefreshBrief)))
	mux.Handle("GET /api/v1/projects/{projectID}/knowledge", protect(http.HandlerFunc(projects.ListKnowledge)))

	// Skills Library
	mux.Handle("GET /api/v1/skills", protect(http.HandlerFunc(skills.List)))
	mux.Handle("GET /api/v1/agents/{id}/skills", protect(http.HandlerFunc(skills.ListAgentSkills)))
	mux.Handle("POST /api/v1/agents/{id}/skills", protect(http.HandlerFunc(skills.AssignSkill)))
	mux.Handle("DELETE /api/v1/agents/{id}/skills/{skillID}", protect(http.HandlerFunc(skills.RemoveSkill)))

	// Approvals
	mux.Handle("POST /api/v1/workforces/{id}/approvals", protect(http.HandlerFunc(approvals.Create)))
	mux.Handle("GET /api/v1/workforces/{id}/approvals", protect(http.HandlerFunc(approvals.List)))
	mux.Handle("GET /api/v1/workforces/{id}/approvals/pending-count", protect(http.HandlerFunc(approvals.CountPending)))
	mux.Handle("GET /api/v1/approvals/{approvalID}", protect(http.HandlerFunc(approvals.Get)))
	mux.Handle("POST /api/v1/approvals/{approvalID}/resolve", protect(http.HandlerFunc(approvals.Resolve)))

	// Activity Events
	mux.Handle("GET /api/v1/activity", protect(http.HandlerFunc(activity.ListGlobal)))
	mux.Handle("GET /api/v1/workforces/{id}/activity", protect(http.HandlerFunc(activity.List)))

	// Knowledge Base
	mux.Handle("GET /api/v1/knowledge/embedding-status", protect(http.HandlerFunc(kb.EmbeddingStatus)))
	mux.Handle("GET /api/v1/workforces/{id}/knowledge", protect(http.HandlerFunc(kb.List)))
	mux.Handle("POST /api/v1/workforces/{id}/knowledge", protect(http.HandlerFunc(kb.Create)))
	mux.Handle("POST /api/v1/workforces/{id}/knowledge/search", protect(http.HandlerFunc(kb.Search)))
	mux.Handle("GET /api/v1/workforces/{id}/knowledge/count", protect(http.HandlerFunc(kb.Count)))
	mux.Handle("DELETE /api/v1/workforces/{id}/knowledge/{entryID}", protect(http.HandlerFunc(kb.Delete)))

	// Apply global middleware stack (CORS + logging; auth is per-route above)
	var handler http.Handler = mux
	handler = CORSMiddleware(corsOrigins)(handler)
	handler = LoggingMiddleware(handler)

	return handler
}
