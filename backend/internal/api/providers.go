package api

import (
	"context"
	"encoding/json"
	"fmt"
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

	ids, probeErr := probeModelsFromURL(r.Context(), provider.BaseURL, provider.APIKey)
	if probeErr != "" {
		writeError(w, http.StatusBadGateway, probeErr)
		return
	}
	writeJSON(w, http.StatusOK, ids)
}

// TestConnection tests connectivity and key validity without saving a provider.
// POST /api/v1/providers/test
func (h *ProviderHandler) TestConnection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.BaseURL == "" {
		writeError(w, http.StatusBadRequest, "base_url is required")
		return
	}

	models, probeErr := probeModelsFromURL(r.Context(), req.BaseURL, req.APIKey)
	if probeErr != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":     false,
			"models": []string{},
			"error":  probeErr,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"models": models,
		"error":  "",
	})
}

// probeModelsFromURL is the shared logic for hitting GET /models on a base URL.
// Returns model IDs and an error string (empty on success).
func probeModelsFromURL(ctx context.Context, baseURL, apiKey string) ([]string, string) {
	base := strings.TrimRight(baseURL, "/")
	// Providers that end with /openai (e.g. Gemini) or /v1 already have the right prefix
	var modelsURL string
	if strings.HasSuffix(base, "/v1") || strings.HasSuffix(base, "/openai") {
		modelsURL = base + "/models"
	} else {
		modelsURL = base + "/v1/models"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL, nil)
	if err != nil {
		return nil, "failed to build request: " + err.Error()
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "unreachable — check the base URL: " + err.Error()
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, fmt.Sprintf("authentication failed (HTTP %d) — check your API key", resp.StatusCode)
	case http.StatusNotFound:
		return nil, fmt.Sprintf("models endpoint not found (HTTP 404) — check the base URL")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Sprintf("provider returned HTTP %d", resp.StatusCode)
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	ids := []string{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
		for _, m := range result.Data {
			if m.ID != "" {
				ids = append(ids, m.ID)
			}
		}
	}
	return ids, ""
}
