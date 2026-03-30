package api

import (
	"context"
	"net/url"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/aitheros/backend/internal/workspace"
	"github.com/google/uuid"
)

// WorkspaceFileEntry is returned by ListWorkspaceFiles.
type WorkspaceFileEntry struct {
	Path string `json:"path"` // relative to workspace root (e.g. "content/report.md")
	Size int64  `json:"size"`
	Ext  string `json:"ext"` // lowercase extension without dot
}

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

// File serves a file from the workforce workspace.
// GET /api/v1/workforces/{id}/files?path=generated/example.png
func (h *WorkForceHandler) File(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	rel := strings.TrimSpace(r.URL.Query().Get("path"))
	if rel == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}
	if strings.Contains(rel, "%2f") || strings.Contains(rel, "%2F") {
		if decodedRel, decodeErr := url.QueryUnescape(rel); decodeErr == nil && strings.TrimSpace(decodedRel) != "" {
			rel = strings.TrimSpace(decodedRel)
		}
	}

	// Normalize and prevent traversal outside workspace root.
	cleanRel := filepath.Clean(strings.TrimPrefix(rel, "/"))
	if cleanRel == "." || strings.HasPrefix(cleanRel, "..") {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	wf, err := h.store.GetWorkForce(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	workspaceRoot := workspace.WorkspacePath(wf.Name)
	abs := filepath.Join(workspaceRoot, cleanRel)
	workspacePrefix := workspaceRoot + string(os.PathSeparator)
	if abs != workspaceRoot && !strings.HasPrefix(abs, workspacePrefix) {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	info, err := os.Stat(abs)
	if err != nil {
		lowerClean := strings.ToLower(filepath.ToSlash(cleanRel))
		if strings.HasPrefix(lowerClean, "generated/") || strings.Contains(lowerClean, "/generated/") {
			base := filepath.Base(cleanRel)
			if base != "" && base != "." && base != ".." {
				legacyRoots := []string{workspaceRoot}
				if wd, wdErr := os.Getwd(); wdErr == nil && wd != "" {
					legacyRoots = append(legacyRoots, wd)
				}
				if installRoot := filepath.Dir(workspace.WorkforcesRoot); installRoot != "" {
					alreadyAdded := false
					for _, root := range legacyRoots {
						if root == installRoot {
							alreadyAdded = true
							break
						}
					}
					if !alreadyAdded {
						legacyRoots = append(legacyRoots, installRoot)
					}
				}

				for _, root := range legacyRoots {
					candidates := []string{
						filepath.Join(root, cleanRel),
						filepath.Join(root, "generated", base),
					}
					for _, candidate := range candidates {
						if legacyInfo, legacyErr := os.Stat(candidate); legacyErr == nil {
							abs = candidate
							info = legacyInfo
							err = nil
							break
						}
					}
					if err == nil {
						break
					}
				}

				if err != nil {
					pattern := filepath.Join(workspace.WorkforcesRoot, "*", "workspace", "generated", base)
					if matches, globErr := filepath.Glob(pattern); globErr == nil {
						for _, match := range matches {
							if legacyInfo, legacyErr := os.Stat(match); legacyErr == nil {
								abs = match
								info = legacyInfo
								err = nil
								break
							}
						}
					}
				}
			}
		}
	}
	if err != nil {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}
	if info.IsDir() {
		writeError(w, http.StatusBadRequest, "path must be a file")
		return
	}

	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=300")
	http.ServeFile(w, r, abs)
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

// ListWorkspaceFiles walks the workforce workspace and returns a flat list of files.
// GET /api/v1/workforces/{id}/workspace/ls
func (h *WorkForceHandler) ListWorkspaceFiles(w http.ResponseWriter, r *http.Request) {
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

	root := workspace.WorkspacePath(wf.Name)
	if _, statErr := os.Stat(root); statErr != nil {
		// Workspace not provisioned — return empty list rather than 404
		writeJSON(w, http.StatusOK, []WorkspaceFileEntry{})
		return
	}

	var files []WorkspaceFileEntry
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		// Skip hidden files/dirs and common noise
		base := info.Name()
		if strings.HasPrefix(base, ".") {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		// Skip hidden path components
		for _, part := range strings.Split(filepath.ToSlash(rel), "/") {
			if strings.HasPrefix(part, ".") {
				return nil
			}
		}
		ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(base)), ".")
		files = append(files, WorkspaceFileEntry{
			Path: filepath.ToSlash(rel),
			Size: info.Size(),
			Ext:  ext,
		})
		return nil
	})

	if files == nil {
		files = []WorkspaceFileEntry{}
	}
	writeJSON(w, http.StatusOK, files)
}
