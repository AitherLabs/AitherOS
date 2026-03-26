package api

import (
	"context"
	"net/http"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/aitheros/backend/internal/workspace"
	"github.com/google/uuid"
)

type CredentialHandler struct {
	store *store.Store
}

func NewCredentialHandler(s *store.Store) *CredentialHandler {
	return &CredentialHandler{store: s}
}

func (h *CredentialHandler) List(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	creds, err := h.store.ListCredentials(r.Context(), wfID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if creds == nil {
		creds = []*models.Credential{}
	}
	writeJSON(w, http.StatusOK, creds)
}

func (h *CredentialHandler) Upsert(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	var req models.UpsertCredentialRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.Service == "" || req.KeyName == "" || req.Value == "" {
		writeError(w, http.StatusBadRequest, "service, key_name, and value are required")
		return
	}

	cred, err := h.store.UpsertCredential(r.Context(), wfID, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Refresh secrets file
	go h.exportSecrets(wfID)

	writeJSON(w, http.StatusOK, cred)
}

func (h *CredentialHandler) Delete(w http.ResponseWriter, r *http.Request) {
	wfID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid workforce id")
		return
	}

	service := r.PathValue("service")
	keyName := r.PathValue("keyName")
	if service == "" || keyName == "" {
		writeError(w, http.StatusBadRequest, "service and key_name are required")
		return
	}

	if err := h.store.DeleteCredential(r.Context(), wfID, service, keyName); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	// Refresh secrets file
	go h.exportSecrets(wfID)

	writeJSON(w, http.StatusOK, map[string]string{"message": "credential deleted"})
}

// exportSecrets re-exports all credentials for a workforce to the secrets file.
// Called asynchronously after any credential mutation.
func (h *CredentialHandler) exportSecrets(workforceID uuid.UUID) {
	ctx := context.Background()
	wf, err := h.store.GetWorkForce(ctx, workforceID)
	if err != nil {
		return
	}
	root := workspace.WorkforceRoot(wf.Name)
	h.store.ExportSecretsFile(ctx, workforceID, root)
}
