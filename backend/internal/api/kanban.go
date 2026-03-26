package api

import (
	"net/http"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type KanbanHandler struct {
	store *store.Store
}

func NewKanbanHandler(s *store.Store) *KanbanHandler {
	return &KanbanHandler{store: s}
}

func (h *KanbanHandler) List(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	tasks, err := h.store.ListKanbanTasks(r.Context(), wfID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tasks == nil {
		tasks = []*models.KanbanTask{}
	}
	writeJSON(w, http.StatusOK, tasks)
}

func (h *KanbanHandler) Create(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	var req models.CreateKanbanTaskRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	task, err := h.store.CreateKanbanTask(r.Context(), wfID, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (h *KanbanHandler) Update(w http.ResponseWriter, r *http.Request) {
	taskID, err := uuid.Parse(r.PathValue("taskID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid task id")
		return
	}

	var req models.UpdateKanbanTaskRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	task, err := h.store.UpdateKanbanTask(r.Context(), taskID, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *KanbanHandler) Delete(w http.ResponseWriter, r *http.Request) {
	taskID, err := uuid.Parse(r.PathValue("taskID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid task id")
		return
	}

	if err := h.store.DeleteKanbanTask(r.Context(), taskID); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "task deleted"})
}
