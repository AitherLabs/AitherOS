package api

import (
	"net/http"

	"github.com/aitheros/backend/internal/mcp"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type MCPHandler struct {
	store *store.Store
}

func NewMCPHandler(s *store.Store) *MCPHandler {
	return &MCPHandler{store: s}
}

// ── MCP Servers CRUD ──

func (h *MCPHandler) CreateServer(w http.ResponseWriter, r *http.Request) {
	var req models.CreateMCPServerRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" || req.Transport == "" {
		writeError(w, http.StatusBadRequest, "name and transport are required")
		return
	}
	switch req.Transport {
	case "stdio":
		if req.Command == "" {
			writeError(w, http.StatusBadRequest, "stdio transport requires a command")
			return
		}
	case "sse", "streamable_http":
		if req.URL == "" {
			writeError(w, http.StatusBadRequest, "sse/http transport requires a url")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "transport must be stdio, sse, or streamable_http")
		return
	}
	srv, err := h.store.CreateMCPServer(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, srv)
}

func (h *MCPHandler) ListServers(w http.ResponseWriter, r *http.Request) {
	servers, err := h.store.ListMCPServers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if servers == nil {
		servers = []*models.MCPServer{}
	}

	// Attach cached tools to each server and redact secrets
	for _, srv := range servers {
		tools, err := h.store.ListMCPServerTools(r.Context(), srv.ID)
		if err == nil {
			srv.Tools = tools
		}
		srv.RedactSecrets()
	}

	writeJSON(w, http.StatusOK, servers)
}

func (h *MCPHandler) GetServer(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	srv, err := h.store.GetMCPServer(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	// Attach cached tools
	tools, err := h.store.ListMCPServerTools(r.Context(), srv.ID)
	if err == nil {
		srv.Tools = tools
	}
	srv.RedactSecrets()

	writeJSON(w, http.StatusOK, srv)
}

func (h *MCPHandler) UpdateServer(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	var req models.UpdateMCPServerRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	srv, err := h.store.UpdateMCPServer(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, srv)
}

func (h *MCPHandler) DeleteServer(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	if err := h.store.DeleteMCPServer(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ── Server Tools (cached discovery results) ──

func (h *MCPHandler) ListServerTools(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	tools, err := h.store.ListMCPServerTools(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tools == nil {
		tools = []models.MCPToolDefinition{}
	}
	writeJSON(w, http.StatusOK, tools)
}

// DiscoverTools connects to the MCP server, lists available tools, and caches them.
func (h *MCPHandler) DiscoverTools(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	srv, err := h.store.GetMCPServer(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	client, err := mcp.Connect(srv)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to connect to MCP server: "+err.Error())
		return
	}
	defer client.Close()

	tools, err := client.ListTools(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to discover tools: "+err.Error())
		return
	}

	// Cache in DB
	if err := h.store.UpsertMCPServerTools(r.Context(), id, tools); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to cache tools: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, tools)
}

// ── Workforce ↔ MCP Server ──

func (h *MCPHandler) AttachToWorkforce(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}
	var req models.AttachMCPServerRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	srvID, err := uuid.Parse(req.ServerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server_id")
		return
	}
	if err := h.store.AttachMCPServer(r.Context(), wfID, srvID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "attached"})
}

func (h *MCPHandler) DetachFromWorkforce(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}
	srvID, err := uuid.Parse(r.PathValue("serverID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	if err := h.store.DetachMCPServer(r.Context(), wfID, srvID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "detached"})
}

func (h *MCPHandler) ListWorkforceServers(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}
	servers, err := h.store.ListWorkforceMCPServers(r.Context(), wfID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if servers == nil {
		servers = []*models.MCPServer{}
	}

	// Attach tools to each and redact secrets
	for _, srv := range servers {
		tools, _ := h.store.ListMCPServerTools(r.Context(), srv.ID)
		srv.Tools = tools
		srv.RedactSecrets()
	}

	writeJSON(w, http.StatusOK, servers)
}

// ── Agent Tool Permissions ──

func (h *MCPHandler) SetAgentTools(w http.ResponseWriter, r *http.Request) {
	var req models.SetAgentToolsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	agentID, err := uuid.Parse(req.AgentID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent_id")
		return
	}
	serverID, err := uuid.Parse(req.ServerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server_id")
		return
	}
	if err := h.store.SetAgentMCPPermissions(r.Context(), agentID, serverID, req.Tools); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *MCPHandler) RemoveAgentTools(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("agentID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent id")
		return
	}
	serverID, err := uuid.Parse(r.PathValue("serverID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	if err := h.store.RemoveAgentMCPPermissions(r.Context(), agentID, serverID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

func (h *MCPHandler) GetAgentTools(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("agentID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent id")
		return
	}
	serverID, err := uuid.Parse(r.PathValue("serverID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	tools, err := h.store.GetAgentMCPPermissions(r.Context(), agentID, serverID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tools == nil {
		tools = []string{}
	}
	writeJSON(w, http.StatusOK, tools)
}

func (h *MCPHandler) ListAgentServersWithTools(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("agentID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent id")
		return
	}
	data, err := h.store.ListAgentMCPServersWithTools(r.Context(), agentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if data == nil {
		data = []store.AgentMCPServerWithTools{}
	}
	writeJSON(w, http.StatusOK, data)
}
