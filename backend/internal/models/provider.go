package models

import (
	"time"

	"github.com/google/uuid"
)

// ProviderType identifies the LLM provider backend.
type ProviderType string

const (
	ProviderTypeOpenAI       ProviderType = "openai"
	ProviderTypeOpenAICompat ProviderType = "openai_compatible" // Any OpenAI-API-compatible endpoint
	ProviderTypeOllama       ProviderType = "ollama"
	ProviderTypeOpenRouter   ProviderType = "openrouter"
	ProviderTypeLiteLLM      ProviderType = "litellm"
	ProviderTypePicoClaw     ProviderType = "picoclaw"
	ProviderTypeOpenClaw     ProviderType = "openclaw"
)

// ModelType categorises what a model can do.
type ModelType string

const (
	ModelTypeLLM       ModelType = "llm"
	ModelTypeEmbedding ModelType = "embedding"
	ModelTypeRerank    ModelType = "rerank"
	ModelTypeTTS       ModelType = "tts"
	ModelTypeSTT       ModelType = "stt"
	ModelTypeImage     ModelType = "image"
	ModelTypeVideo     ModelType = "video"
	ModelTypeAudio     ModelType = "audio"
)

// ModelProvider represents a configured LLM provider (e.g. "My OpenAI Key", "Local Ollama").
type ModelProvider struct {
	ID           uuid.UUID         `json:"id" db:"id"`
	Name         string            `json:"name" db:"name"`
	ProviderType ProviderType      `json:"provider_type" db:"provider_type"`
	BaseURL      string            `json:"base_url" db:"base_url"`
	APIKey       string            `json:"api_key,omitempty" db:"api_key"` // encrypted at rest
	IsEnabled    bool              `json:"is_enabled" db:"is_enabled"`
	IsDefault    bool              `json:"is_default" db:"is_default"`
	Config       map[string]any    `json:"config" db:"config"` // provider-specific settings
	CreatedAt    time.Time         `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at" db:"updated_at"`
	Models       []ProviderModel   `json:"models,omitempty"`
}

// ProviderModel represents a specific model available under a provider.
type ProviderModel struct {
	ID         uuid.UUID      `json:"id" db:"id"`
	ProviderID uuid.UUID      `json:"provider_id" db:"provider_id"`
	ModelName  string         `json:"model_name" db:"model_name"`
	ModelType  ModelType      `json:"model_type" db:"model_type"`
	IsEnabled  bool           `json:"is_enabled" db:"is_enabled"`
	Config     map[string]any `json:"config" db:"config"` // model-specific overrides (max_tokens, temperature defaults, etc.)
	CreatedAt  time.Time      `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at" db:"updated_at"`
}

// CredentialSchema describes what fields a provider type needs for configuration.
type CredentialSchema struct {
	ProviderType ProviderType      `json:"provider_type"`
	Fields       []CredentialField `json:"fields"`
}

type CredentialField struct {
	Name        string `json:"name"`
	Label       string `json:"label"`
	Type        string `json:"type"` // "text", "secret", "url", "select", "boolean"
	Required    bool   `json:"required"`
	Placeholder string `json:"placeholder,omitempty"`
	Default     string `json:"default,omitempty"`
	HelpText    string `json:"help_text,omitempty"`
}

// --- Request structs ---

type CreateProviderRequest struct {
	Name         string         `json:"name" validate:"required,min=1,max=255"`
	ProviderType ProviderType   `json:"provider_type" validate:"required"`
	BaseURL      string         `json:"base_url"`
	APIKey       string         `json:"api_key"`
	IsDefault    bool           `json:"is_default"`
	Config       map[string]any `json:"config"`
}

type UpdateProviderRequest struct {
	Name      *string        `json:"name,omitempty"`
	BaseURL   *string        `json:"base_url,omitempty"`
	APIKey    *string        `json:"api_key,omitempty"`
	IsEnabled *bool          `json:"is_enabled,omitempty"`
	IsDefault *bool          `json:"is_default,omitempty"`
	Config    map[string]any `json:"config,omitempty"`
}

type CreateProviderModelRequest struct {
	ModelName string         `json:"model_name" validate:"required"`
	ModelType ModelType      `json:"model_type" validate:"required"`
	Config    map[string]any `json:"config"`
}

type UpdateProviderModelRequest struct {
	IsEnabled *bool          `json:"is_enabled,omitempty"`
	Config    map[string]any `json:"config,omitempty"`
}
