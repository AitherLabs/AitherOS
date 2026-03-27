package api

import (
	"encoding/json"
	"net/http"

	"github.com/aitheros/backend/internal/knowledge"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type KnowledgeHandler struct {
	store   *store.Store
	manager *knowledge.Manager
}

func NewKnowledgeHandler(s *store.Store, km *knowledge.Manager) *KnowledgeHandler {
	return &KnowledgeHandler{store: s, manager: km}
}

// ListKnowledge returns knowledge entries for a workforce.
func (h *KnowledgeHandler) List(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce ID")
		return
	}

	entries, err := h.store.ListKnowledge(r.Context(), wfID, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entries == nil {
		entries = []models.KnowledgeEntry{}
	}
	writeJSON(w, http.StatusOK, entries)
}

// Search performs a semantic search in the workforce knowledge base.
func (h *KnowledgeHandler) Search(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce ID")
		return
	}

	var req models.SearchKnowledgeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}
	if req.Limit <= 0 {
		req.Limit = 5
	}

	if h.manager == nil {
		writeError(w, http.StatusServiceUnavailable, "knowledge manager not configured")
		return
	}

	// Get the embedding for the query, then search
	results, err := func() ([]models.KnowledgeEntry, error) {
		emb, err := h.manager.RetrieveEmbedding(r.Context(), req.Query)
		if err != nil {
			return nil, err
		}
		return h.store.SearchKnowledge(r.Context(), wfID, emb, req.Limit)
	}()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if results == nil {
		results = []models.KnowledgeEntry{}
	}
	writeJSON(w, http.StatusOK, results)
}

// Create adds a manual knowledge entry to a workforce.
func (h *KnowledgeHandler) Create(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce ID")
		return
	}

	var req models.CreateKnowledgeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	if h.manager == nil {
		writeError(w, http.StatusServiceUnavailable, "knowledge manager not configured")
		return
	}

	entry, err := h.manager.IngestManual(r.Context(), wfID, req.Title, req.Content)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

// Delete removes a knowledge entry.
func (h *KnowledgeHandler) Delete(w http.ResponseWriter, r *http.Request) {
	entryID, err := uuid.Parse(r.PathValue("entryID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid entry ID")
		return
	}

	if err := h.store.DeleteKnowledgeEntry(r.Context(), entryID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, "deleted")
}

// EmbeddingStatus probes the configured embedding endpoint and returns live status.
// GET /api/v1/knowledge/embedding-status
func (h *KnowledgeHandler) EmbeddingStatus(w http.ResponseWriter, r *http.Request) {
	status := h.manager.ProbeEmbedder(r.Context())
	writeJSON(w, http.StatusOK, status)
}

// Count returns the number of knowledge entries for a workforce.
func (h *KnowledgeHandler) Count(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce ID")
		return
	}

	count, err := h.store.CountKnowledge(r.Context(), wfID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": count})
}
