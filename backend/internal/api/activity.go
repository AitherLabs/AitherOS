package api

import (
	"net/http"
	"strconv"

	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type ActivityHandler struct {
	store *store.Store
}

func NewActivityHandler(s *store.Store) *ActivityHandler {
	return &ActivityHandler{store: s}
}

func (h *ActivityHandler) List(w http.ResponseWriter, r *http.Request) {
	// If workforce ID is in the path, scope to that workforce
	wfIDStr := r.PathValue("id")
	var wfID *uuid.UUID
	if wfIDStr != "" {
		parsed, err := uuid.Parse(wfIDStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid workforce ID")
			return
		}
		wfID = &parsed
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	events, total, err := h.store.ListActivity(r.Context(), wfID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSONList(w, http.StatusOK, events, total)
}

// ListGlobal returns activity events across all workforces.
func (h *ActivityHandler) ListGlobal(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	events, total, err := h.store.ListActivity(r.Context(), nil, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSONList(w, http.StatusOK, events, total)
}
