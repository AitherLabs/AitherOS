package api

import (
	"net/http"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type BetaHandler struct {
	store *store.Store
}

func NewBetaHandler(s *store.Store) *BetaHandler {
	return &BetaHandler{store: s}
}

// Signup handles a public beta waitlist submission.
// POST /api/v1/beta/signup
func (h *BetaHandler) Signup(w http.ResponseWriter, r *http.Request) {
	var req models.BetaSignupRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	entry, err := h.store.CreateBetaSignup(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

// List returns all waitlist entries (admin only).
// GET /api/v1/admin/beta/signups
func (h *BetaHandler) List(w http.ResponseWriter, r *http.Request) {
	entries, err := h.store.ListBetaSignups(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entries == nil {
		entries = []*models.BetaSignup{}
	}
	writeJSON(w, http.StatusOK, entries)
}

// UpdateStatus sets pending/approved/rejected on a signup (admin only).
// PATCH /api/v1/admin/beta/signups/{id}/status
func (h *BetaHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var body models.BetaSignupStatusUpdate
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.store.UpdateBetaSignupStatus(r.Context(), id, body.Status); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": body.Status})
}
