package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/orchestrator"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type ExecutionHandler struct {
	store        *store.Store
	orchestrator *orchestrator.Orchestrator
}

func NewExecutionHandler(s *store.Store, o *orchestrator.Orchestrator) *ExecutionHandler {
	return &ExecutionHandler{store: s, orchestrator: o}
}

func (h *ExecutionHandler) Start(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	var req models.StartExecutionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Objective == "" {
		writeError(w, http.StatusBadRequest, "objective is required")
		return
	}

	exec, err := h.orchestrator.StartExecution(r.Context(), wfID, req.Objective, req.Inputs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start execution: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, exec)
}

func (h *ExecutionHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	exec, err := h.store.GetExecution(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	h.attachPendingApproval(r, exec)
	writeJSON(w, http.StatusOK, exec)
}

// GetDirect fetches an execution by ID only — no workforce ID required in the path.
func (h *ExecutionHandler) GetDirect(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	exec, err := h.store.GetExecution(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	h.attachPendingApproval(r, exec)
	writeJSON(w, http.StatusOK, exec)
}

// attachPendingApproval fetches and embeds the pending approval when status == awaiting_approval.
func (h *ExecutionHandler) attachPendingApproval(r *http.Request, exec *models.Execution) {
	if exec.Status != models.ExecutionStatusAwaitingApproval {
		return
	}
	approval, err := h.store.GetPendingApprovalForExecution(r.Context(), exec.ID)
	if err == nil && approval != nil {
		exec.PendingApproval = approval
	}
}

func (h *ExecutionHandler) List(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	execs, total, err := h.store.ListExecutions(r.Context(), wfID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list executions: "+err.Error())
		return
	}

	writeJSONList(w, http.StatusOK, execs, total)
}

func (h *ExecutionHandler) Approve(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	var req models.ApproveExecutionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := h.orchestrator.ApproveExecution(r.Context(), execID, req.Approved, req.Feedback); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "execution approval processed"})
}

func (h *ExecutionHandler) Halt(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	if err := h.orchestrator.HaltExecution(execID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "halt signal sent"})
}

// UpdateMeta patches the title, description, or image_url of an execution.
func (h *ExecutionHandler) UpdateMeta(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	var req models.UpdateExecutionMetaRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := h.store.UpdateExecutionMeta(r.Context(), execID, req); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update execution: "+err.Error())
		return
	}

	exec, err := h.store.GetExecution(r.Context(), execID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, exec)
}

// Intervene injects a human message into a running execution mid-flight.
// The message is picked up by the pipeline loop on its next iteration,
// unblocking any needs_help subtasks and injecting context into the next agent.
func (h *ExecutionHandler) Intervene(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Message == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	if err := h.orchestrator.InjectIntervention(execID, body.Message); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "intervention injected"})
}

// Messages returns the full conversation transcript for an execution.
func (h *ExecutionHandler) Messages(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	msgs, total, err := h.store.ListMessages(r.Context(), execID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list messages: "+err.Error())
		return
	}

	writeJSONList(w, http.StatusOK, msgs, total)
}
