package api

import (
	"net/http"
	"strconv"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type ApprovalHandler struct {
	store *store.Store
}

func NewApprovalHandler(s *store.Store) *ApprovalHandler {
	return &ApprovalHandler{store: s}
}

func (h *ApprovalHandler) Create(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce ID")
		return
	}

	var req models.CreateApprovalRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if req.ActionType == "" {
		req.ActionType = models.ApprovalActionCustom
	}

	approval, err := h.store.CreateApproval(r.Context(), wfID, &req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Record activity
	h.store.RecordActivity(r.Context(), &models.ActivityEvent{
		WorkforceID:  &wfID,
		ExecutionID:  req.ExecutionID,
		ActorType:    models.ActorTypeSystem,
		ActorName:    req.RequestedBy,
		Action:       "approval.created",
		ResourceType: "approval",
		ResourceID:   approval.ID.String(),
		Summary:      "Approval requested: " + req.Title,
		Metadata: map[string]any{
			"action_type": string(req.ActionType),
			"confidence":  req.Confidence,
		},
	})

	writeJSON(w, http.StatusCreated, approval)
}

func (h *ApprovalHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("approvalID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid approval ID")
		return
	}

	approval, err := h.store.GetApproval(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, approval)
}

func (h *ApprovalHandler) List(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce ID")
		return
	}

	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	approvals, total, err := h.store.ListApprovals(r.Context(), wfID, status, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSONList(w, http.StatusOK, approvals, total)
}

func (h *ApprovalHandler) Resolve(w http.ResponseWriter, r *http.Request) {
	approvalID, err := uuid.Parse(r.PathValue("approvalID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid approval ID")
		return
	}

	var req models.ResolveApprovalRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ResolvedBy == "" {
		req.ResolvedBy = "operator"
	}

	approval, err := h.store.ResolveApproval(r.Context(), approvalID, req.Approved, req.ReviewerNotes, req.ResolvedBy)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Record activity
	action := "approval.rejected"
	if req.Approved {
		action = "approval.approved"
	}
	h.store.RecordActivity(r.Context(), &models.ActivityEvent{
		WorkforceID:  &approval.WorkforceID,
		ExecutionID:  approval.ExecutionID,
		ActorType:    models.ActorTypeUser,
		ActorID:      req.ResolvedBy,
		ActorName:    req.ResolvedBy,
		Action:       action,
		ResourceType: "approval",
		ResourceID:   approval.ID.String(),
		Summary:      action + ": " + approval.Title,
		Metadata: map[string]any{
			"reviewer_notes": req.ReviewerNotes,
			"action_type":    string(approval.ActionType),
		},
	})

	writeJSON(w, http.StatusOK, approval)
}

func (h *ApprovalHandler) CountPending(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce ID")
		return
	}

	count, err := h.store.CountPendingApprovals(r.Context(), wfID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]int{"count": count})
}
