package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/aitheros/backend/internal/engine"
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

	if req.ProjectID != nil && *req.ProjectID != "" {
		if pid, parseErr := uuid.Parse(*req.ProjectID); parseErr == nil {
			_ = h.store.SetExecutionProject(r.Context(), exec.ID, pid)
			exec.ProjectID = &pid
		}
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

func (h *ExecutionHandler) ListAll(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	execs, total, err := h.store.ListAllExecutions(r.Context(), limit, offset)
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

// Preflight validates a workforce before launching an execution (no side effects).
func (h *ExecutionHandler) Preflight(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}
	result := h.orchestrator.Preflight(r.Context(), wfID)
	writeJSON(w, http.StatusOK, result)
}

// DiscussionMessages returns only the pre-execution discussion messages for an execution.
func (h *ExecutionHandler) DiscussionMessages(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	msgs, err := h.store.ListMessagesByPhase(r.Context(), execID, models.MessagePhaseDiscussion)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list discussion messages: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, msgs)
}

// ReviewMessages returns the post-execution review messages for an execution.
func (h *ExecutionHandler) ReviewMessages(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	msgs, err := h.store.ListMessagesByPhase(r.Context(), execID, models.MessagePhaseReview)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list review messages: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, msgs)
}

func (h *ExecutionHandler) Resume(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	if err := h.orchestrator.ResumeExecution(r.Context(), execID); err != nil {
		if strings.Contains(err.Error(), "not halted") {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to resume execution: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "resumed"})
}

// AskQA submits a question about a finished execution and returns an LLM answer.
func (h *ExecutionHandler) AskQA(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	var body struct {
		Question string `json:"question"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Question) == "" {
		writeError(w, http.StatusBadRequest, "question is required")
		return
	}

	answer, err := h.orchestrator.AnswerQuestion(r.Context(), execID, body.Question, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "qa failed: "+err.Error())
		return
	}

	qa, err := h.store.CreateExecutionQA(r.Context(), execID, body.Question, answer)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save qa: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, qa)
}

// Chat is the interactive execution chatbot endpoint.
//   - mode "ask": answers a question using the execution transcript (multi-turn)
//   - mode "instruct": sends an instruction to agents — resumes halted executions,
//     injects into running ones, or starts a follow-up execution when complete
func (h *ExecutionHandler) Chat(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	var body struct {
		Mode    string `json:"mode"` // "ask" | "instruct"
		Message string `json:"message"`
		History []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"history"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Message) == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	type actionResult struct {
		Type        string `json:"type"`
		ExecutionID string `json:"execution_id,omitempty"`
		Message     string `json:"message"`
	}
	type chatReply struct {
		Kind   string        `json:"kind"` // "answer" | "action"
		ID     string        `json:"id"`
		Input  string        `json:"input"`
		Answer string        `json:"answer,omitempty"`
		Action *actionResult `json:"action,omitempty"`
	}

	if body.Mode == "instruct" {
		exec, err := h.store.GetExecution(r.Context(), execID)
		if err != nil {
			writeError(w, http.StatusNotFound, "execution not found")
			return
		}

		reply := chatReply{Kind: "action", ID: uuid.New().String(), Input: body.Message}
		var ar actionResult

		switch exec.Status {
		case models.ExecutionStatusHalted:
			if err := h.orchestrator.ResumeWithInstruction(r.Context(), execID, body.Message); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to resume: "+err.Error())
				return
			}
			ar = actionResult{Type: "resumed", ExecutionID: execID.String(), Message: "Execution resumed with your instruction. Agents are back to work."}
		case models.ExecutionStatusRunning:
			if err := h.orchestrator.InjectIntervention(execID, body.Message); err != nil {
				writeError(w, http.StatusConflict, "cannot deliver message: "+err.Error())
				return
			}
			ar = actionResult{Type: "intervened", ExecutionID: execID.String(), Message: "Message delivered to running agents."}
		default:
			newExec, err := h.orchestrator.ContinueExecution(r.Context(), execID, body.Message)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to start follow-up: "+err.Error())
				return
			}
			ar = actionResult{Type: "new_execution", ExecutionID: newExec.ID.String(), Message: "Started a new execution with your instruction."}
		}

		reply.Action = &ar
		summary := ar.Message
		if ar.ExecutionID != "" && ar.ExecutionID != execID.String() {
			summary += " (new execution " + ar.ExecutionID[:8] + "…)"
		}
		h.store.CreateExecutionQA(r.Context(), execID, "[send] "+body.Message, summary)
		writeJSON(w, http.StatusOK, reply)
		return
	}

	// "ask" mode — convert history for the orchestrator
	var hist []engine.ChatMessage
	for _, m := range body.History {
		hist = append(hist, engine.ChatMessage{Role: m.Role, Content: m.Content})
	}

	answer, err := h.orchestrator.AnswerQuestion(r.Context(), execID, body.Message, hist)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "chat failed: "+err.Error())
		return
	}

	qa, err := h.store.CreateExecutionQA(r.Context(), execID, body.Message, answer)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, chatReply{Kind: "answer", ID: qa.ID.String(), Input: body.Message, Answer: answer})
}

// Events returns the persisted event log for an execution (action-level events only).
func (h *ExecutionHandler) Events(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	events, err := h.store.ListExecutionEvents(r.Context(), execID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list events: "+err.Error())
		return
	}
	if events == nil {
		events = []*models.Event{}
	}

	writeJSON(w, http.StatusOK, events)
}

// ListQA returns all Q&A pairs for an execution.
func (h *ExecutionHandler) ListQA(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	items, err := h.store.ListExecutionQA(r.Context(), execID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list qa: "+err.Error())
		return
	}
	if items == nil {
		items = []*store.ExecutionQA{}
	}

	writeJSON(w, http.StatusOK, items)
}

func (h *ExecutionHandler) Delete(w http.ResponseWriter, r *http.Request) {
	execID, err := uuid.Parse(r.PathValue("execID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	exec, err := h.store.GetExecution(r.Context(), execID)
	if err != nil {
		writeError(w, http.StatusNotFound, "execution not found")
		return
	}
	if exec.Status == models.ExecutionStatusRunning || exec.Status == models.ExecutionStatusPlanning {
		writeError(w, http.StatusConflict, "cannot delete a running execution — halt it first")
		return
	}

	if err := h.store.DeleteExecution(r.Context(), execID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete execution: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"deleted": execID.String()})
}

func (h *ExecutionHandler) GlobalStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.store.GetGlobalStats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch stats: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (h *ExecutionHandler) TokenBreakdown(w http.ResponseWriter, r *http.Request) {
	rows, err := h.store.GetTokenBreakdown(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch token breakdown: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}
