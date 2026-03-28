package api

import (
	"context"
	"net/http"
	"os"
	"strconv"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/aitheros/backend/internal/workspace"
	"github.com/google/uuid"
)

// workspacePathIfProvisioned returns the workspace path only if the directory exists on disk.
// Returns empty string otherwise so the frontend can show a "Provision" button.
func workspacePathIfProvisioned(wfName string) string {
	path := workspace.WorkspacePath(wfName)
	if _, err := os.Stat(path); err == nil {
		return path
	}
	return ""
}

type WorkForceHandler struct {
	store       *store.Store
	provisioner *workspace.Provisioner
}

func NewWorkForceHandler(s *store.Store, p *workspace.Provisioner) *WorkForceHandler {
	return &WorkForceHandler{store: s, provisioner: p}
}

func (h *WorkForceHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req models.CreateWorkForceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Objective == "" {
		writeError(w, http.StatusBadRequest, "objective is required")
		return
	}
	if len(req.AgentIDs) == 0 {
		writeError(w, http.StatusBadRequest, "at least one agent_id is required")
		return
	}

	wf, err := h.store.CreateWorkForce(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create workforce: "+err.Error())
		return
	}

	// Provision workspace + Aither-Tools synchronously so the MCP server is
	// visible immediately when the Create response reaches the frontend.
	// Only tool discovery runs in the background (see provisioner.go).
	h.provisioner.Provision(context.Background(), wf)

	wf.WorkspacePath = workspacePathIfProvisioned(wf.Name)
	writeJSON(w, http.StatusCreated, wf)
}

func (h *WorkForceHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	wf, err := h.store.GetWorkForce(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	// Load full agent objects for the response
	h.store.LoadWorkForceAgents(r.Context(), wf)

	wf.WorkspacePath = workspacePathIfProvisioned(wf.Name)
	writeJSON(w, http.StatusOK, wf)
}

func (h *WorkForceHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	workforces, total, err := h.store.ListWorkForces(r.Context(), limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list workforces: "+err.Error())
		return
	}

	for _, wf := range workforces {
		wf.WorkspacePath = workspacePathIfProvisioned(wf.Name)
	}
	writeJSONList(w, http.StatusOK, workforces, total)
}

func (h *WorkForceHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	var req models.UpdateWorkForceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	wf, err := h.store.UpdateWorkForce(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update workforce: "+err.Error())
		return
	}

	wf.WorkspacePath = workspacePathIfProvisioned(wf.Name)
	writeJSON(w, http.StatusOK, wf)
}

func (h *WorkForceHandler) Provision(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	wf, err := h.store.GetWorkForce(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	go h.provisioner.Provision(context.Background(), wf)

	writeJSON(w, http.StatusOK, map[string]string{
		"message":        "provisioning started",
		"workspace_path": workspace.WorkspacePath(wf.Name),
	})
}

func (h *WorkForceHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	// Fetch before deleting so we have the name to derive the workspace path.
	wf, err := h.store.GetWorkForce(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	if err := h.store.DeleteWorkForce(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	// Clean up the workforce directory from disk (workspace, notes, logs, tools).
	// Non-fatal: log but don't fail the response if removal hits a permission issue.
	rootDir := workspace.WorkforceRoot(wf.Name)
	if rmErr := os.RemoveAll(rootDir); rmErr != nil {
		// Log but don't fail — DB record is gone, that's the important part.
		_ = rmErr
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "workforce deleted"})
}
