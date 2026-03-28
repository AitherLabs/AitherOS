package engine

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

// ProviderRegistry resolves a provider ID + model name into an engine Connector
// that can talk to the appropriate LLM backend.
type ProviderRegistry struct {
	store      *store.Store
	connectors map[string]Connector // engine_type → Connector (for agent-level engines like picoclaw)
	mu         sync.RWMutex
}

func NewProviderRegistry(s *store.Store) *ProviderRegistry {
	return &ProviderRegistry{
		store:      s,
		connectors: make(map[string]Connector),
	}
}

// RegisterConnector registers a named engine connector (picoclaw, openclaw, etc.)
func (r *ProviderRegistry) RegisterConnector(name string, c Connector) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connectors[name] = c
}

// GetConnector returns a registered connector by engine type name.
func (r *ProviderRegistry) GetConnector(name string) (Connector, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.connectors[name]
	return c, ok
}

// ResolveForAgent returns the Connector + resolved model name for a given agent.
// Priority: agent.ProviderID → agent.EngineType → default provider.
// If the agent's model is registered as type "image" in its provider, an
// imageConnector is returned instead of the standard OpenAI-compat connector.
func (r *ProviderRegistry) ResolveForAgent(ctx context.Context, agent *models.Agent) (Connector, string, error) {
	// If agent has a provider_id, use it to build a connector
	if agent.ProviderID != nil {
		provider, err := r.store.GetProvider(ctx, *agent.ProviderID)
		if err != nil {
			return nil, "", fmt.Errorf("resolve provider %s: %w", agent.ProviderID, err)
		}
		modelName := agent.Model

		// Check if the agent's model is registered as an image (or video/audio) type.
		// If so, route through the image connector instead of chat completions.
		for _, m := range provider.Models {
			if m.ModelName == modelName && m.IsEnabled &&
				(m.ModelType == models.ModelTypeImage || m.ModelType == models.ModelTypeVideo || m.ModelType == models.ModelTypeAudio) {
				baseURL := provider.BaseURL
				if baseURL == "" {
					baseURL = defaultBaseURL(provider.ProviderType)
				}
				conn := newImageConnector(string(provider.ProviderType), baseURL, provider.APIKey, modelName)
				return conn, modelName, nil
			}
		}

		conn := r.buildOpenAICompatConnector(provider)
		return conn, modelName, nil
	}

	// If agent specifies an engine type, use the registered connector
	if agent.EngineType != "" {
		r.mu.RLock()
		c, ok := r.connectors[agent.EngineType]
		r.mu.RUnlock()
		if ok {
			return c, agent.Model, nil
		}
	}

	// Fallback: try default provider
	provider, err := r.store.GetDefaultProvider(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("no engine or default provider available for agent %s: %w", agent.Name, err)
	}
	conn := r.buildOpenAICompatConnector(provider)
	return conn, agent.Model, nil
}

// ResolveByProviderID returns a connector for a specific provider by ID.
func (r *ProviderRegistry) ResolveByProviderID(ctx context.Context, providerID uuid.UUID, modelName string) (Connector, string, error) {
	provider, err := r.store.GetProvider(ctx, providerID)
	if err != nil {
		return nil, "", fmt.Errorf("resolve provider %s: %w", providerID, err)
	}
	conn := r.buildOpenAICompatConnector(provider)
	return conn, modelName, nil
}

// buildOpenAICompatConnector creates a generic OpenAI-compatible connector from a ModelProvider.
// Works for: openai, openai_compatible, openrouter, litellm, ollama (with /v1 compat).
func (r *ProviderRegistry) buildOpenAICompatConnector(provider *models.ModelProvider) Connector {
	baseURL := provider.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL(provider.ProviderType)
	}
	// Strip trailing /v1 — the connector appends /v1/chat/completions itself.
	baseURL = strings.TrimSuffix(strings.TrimRight(baseURL, "/"), "/v1")

	return &openAICompatConnector{
		providerName: string(provider.ProviderType),
		baseURL:      baseURL,
		apiKey:       provider.APIKey,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

func defaultBaseURL(pt models.ProviderType) string {
	switch pt {
	case models.ProviderTypeOpenAI:
		return "https://api.openai.com"
	case models.ProviderTypeOpenRouter:
		return "https://openrouter.ai/api"
	case models.ProviderTypeOllama:
		return "http://127.0.0.1:11434"
	case models.ProviderTypeLiteLLM:
		return "http://127.0.0.1:4000"
	default:
		return "http://127.0.0.1:4000"
	}
}

// GetCredentialSchemas returns the credential form schema for all supported provider types.
func GetCredentialSchemas() []models.CredentialSchema {
	return []models.CredentialSchema{
		{
			ProviderType: models.ProviderTypeOpenAI,
			Fields: []models.CredentialField{
				{Name: "api_key", Label: "API Key", Type: "secret", Required: true, Placeholder: "sk-..."},
			},
		},
		{
			ProviderType: models.ProviderTypeOpenAICompat,
			Fields: []models.CredentialField{
				{Name: "base_url", Label: "Base URL", Type: "url", Required: true, Placeholder: "https://api.example.com"},
				{Name: "api_key", Label: "API Key", Type: "secret", Required: false, Placeholder: "Optional API key"},
			},
		},
		{
			ProviderType: models.ProviderTypeOllama,
			Fields: []models.CredentialField{
				{Name: "base_url", Label: "Base URL", Type: "url", Required: true, Default: "http://127.0.0.1:11434", Placeholder: "http://host:11434"},
			},
		},
		{
			ProviderType: models.ProviderTypeOpenRouter,
			Fields: []models.CredentialField{
				{Name: "api_key", Label: "API Key", Type: "secret", Required: true, Placeholder: "sk-or-..."},
			},
		},
		{
			ProviderType: models.ProviderTypeLiteLLM,
			Fields: []models.CredentialField{
				{Name: "base_url", Label: "Proxy URL", Type: "url", Required: true, Default: "http://127.0.0.1:4000", Placeholder: "http://host:4000"},
				{Name: "api_key", Label: "Master Key", Type: "secret", Required: false},
			},
		},
		{
			ProviderType: models.ProviderTypePicoClaw,
			Fields: []models.CredentialField{
				{Name: "base_url", Label: "PicoClaw URL", Type: "url", Required: true, Default: "http://127.0.0.1:55000"},
			},
		},
		{
			ProviderType: models.ProviderTypeOpenClaw,
			Fields: []models.CredentialField{
				{Name: "base_url", Label: "OpenClaw URL", Type: "url", Required: true},
				{Name: "api_key", Label: "API Key", Type: "secret", Required: false},
			},
		},
	}
}
