package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type ProviderHandler struct {
	store *store.Store
}

func NewProviderHandler(s *store.Store) *ProviderHandler {
	return &ProviderHandler{store: s}
}

func (h *ProviderHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req models.CreateProviderRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.ProviderType == "" {
		writeError(w, http.StatusBadRequest, "provider_type is required")
		return
	}

	provider, err := h.store.CreateProvider(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create provider: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, provider)
}

func (h *ProviderHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider id")
		return
	}

	provider, err := h.store.GetProvider(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	// Mask the API key for security
	if len(provider.APIKey) > 8 {
		provider.APIKey = provider.APIKey[:4] + "****" + provider.APIKey[len(provider.APIKey)-4:]
	} else if provider.APIKey != "" {
		provider.APIKey = "****"
	}

	writeJSON(w, http.StatusOK, provider)
}

func (h *ProviderHandler) List(w http.ResponseWriter, r *http.Request) {
	providers, err := h.store.ListProviders(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list providers: "+err.Error())
		return
	}

	// Mask API keys
	for _, p := range providers {
		if len(p.APIKey) > 8 {
			p.APIKey = p.APIKey[:4] + "****" + p.APIKey[len(p.APIKey)-4:]
		} else if p.APIKey != "" {
			p.APIKey = "****"
		}
	}

	writeJSONList(w, http.StatusOK, providers, len(providers))
}

func (h *ProviderHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider id")
		return
	}

	var req models.UpdateProviderRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	provider, err := h.store.UpdateProvider(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update provider: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, provider)
}

func (h *ProviderHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider id")
		return
	}

	if err := h.store.DeleteProvider(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "provider deleted"})
}

// Schemas returns the credential form schemas for all supported provider types.
func (h *ProviderHandler) Schemas(w http.ResponseWriter, r *http.Request) {
	schemas := engine.GetCredentialSchemas()
	writeJSON(w, http.StatusOK, schemas)
}

// AddModel adds a model to a provider.
func (h *ProviderHandler) AddModel(w http.ResponseWriter, r *http.Request) {
	providerID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider id")
		return
	}

	var req models.CreateProviderModelRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.ModelName == "" {
		writeError(w, http.StatusBadRequest, "model_name is required")
		return
	}
	if req.ModelType == "" {
		req.ModelType = models.ModelTypeLLM
	}

	model, err := h.store.CreateProviderModel(r.Context(), providerID, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add model: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, model)
}

// RemoveModel removes a model from a provider.
func (h *ProviderHandler) RemoveModel(w http.ResponseWriter, r *http.Request) {
	modelID, err := uuid.Parse(r.PathValue("modelID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid model id")
		return
	}

	if err := h.store.DeleteProviderModel(r.Context(), modelID); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "model removed"})
}

// ProbeModels calls the provider's /v1/models endpoint and returns live model IDs.
func (h *ProviderHandler) ProbeModels(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider id")
		return
	}

	provider, err := h.store.GetProvider(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	base := strings.TrimRight(provider.BaseURL, "/")
	var modelsURL string
	if strings.HasSuffix(base, "/v1") {
		modelsURL = base + "/models"
	} else {
		modelsURL = base + "/v1/models"
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, modelsURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build request: "+err.Error())
		return
	}
	if provider.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+provider.APIKey)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to reach provider: "+err.Error())
		return
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		writeError(w, http.StatusBadGateway, "failed to parse response: "+err.Error())
		return
	}

	ids := make([]string, 0, len(result.Data))
	for _, m := range result.Data {
		ids = append(ids, m.ID)
	}
	writeJSON(w, http.StatusOK, ids)
}
