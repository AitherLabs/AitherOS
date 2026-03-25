package api

import (
	"encoding/json"
	"net/http"

	"github.com/aitheros/backend/internal/auth"
	"github.com/aitheros/backend/internal/knowledge"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type AgentChatHandler struct {
	store    *store.Store
	knowledge *knowledge.Manager
}

func NewAgentChatHandler(s *store.Store, km *knowledge.Manager) *AgentChatHandler {
	return &AgentChatHandler{store: s, knowledge: km}
}

// List returns all chat messages for an agent.
// GET /api/v1/agents/{id}/chats
func (h *AgentChatHandler) List(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid agent id"})
		return
	}

	chats, err := h.store.ListAgentChats(r.Context(), agentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": chats})
}

// Create appends a single chat message for an agent.
// POST /api/v1/agents/{id}/chats
func (h *AgentChatHandler) Create(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid agent id"})
		return
	}

	var req models.CreateAgentChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.Role == "" || req.Content == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "role and content are required"})
		return
	}

	// Extract user ID from JWT context if available
	var userID *uuid.UUID
	if claims := auth.GetClaims(r.Context()); claims != nil {
		uid := claims.UserID
		userID = &uid
	}

	chat, err := h.store.CreateAgentChat(r.Context(), agentID, userID, req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Ingest substantial assistant responses into the agent's KB (async, best-effort)
	if h.knowledge != nil && req.Role == "assistant" && len(req.Content) >= 100 {
		wfIDs, _ := h.store.ListAgentWorkforceIDs(r.Context(), agentID)
		if len(wfIDs) > 0 {
			h.knowledge.IngestSingleMessage(r.Context(), wfIDs[0], uuid.Nil, &agentID,
				chat.AgentID.String(), 0, req.Content, "")
		}
	}

	writeJSON(w, http.StatusCreated, map[string]any{"data": chat})
}

// Clear deletes all chat messages for an agent.
// DELETE /api/v1/agents/{id}/chats
func (h *AgentChatHandler) Clear(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid agent id"})
		return
	}

	if err := h.store.ClearAgentChats(r.Context(), agentID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cleared"})
}
