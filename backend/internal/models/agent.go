package models

import (
	"time"

	"github.com/google/uuid"
)

type AgentStatus string

const (
	AgentStatusActive   AgentStatus = "active"
	AgentStatusInactive AgentStatus = "inactive"
	AgentStatusArchived AgentStatus = "archived"
)

// AgentStrategy determines the reasoning mode used by the agent engine.
type AgentStrategy string

const (
	AgentStrategySimple       AgentStrategy = "simple"        // Single prompt, no tool loop
	AgentStrategyFunctionCall AgentStrategy = "function_call"  // OpenAI-style function calling
	AgentStrategyReAct        AgentStrategy = "react"          // Chain-of-thought with Thought→Action→Observation loop
)

// VariableType defines the input field type rendered in the frontend.
type VariableType string

const (
	VariableTypeText      VariableType = "text"
	VariableTypeParagraph VariableType = "paragraph"
	VariableTypeNumber    VariableType = "number"
	VariableTypeSelect    VariableType = "select"
	VariableTypeCheckbox  VariableType = "checkbox"
)

// AgentVariable defines a user-configurable input variable for the agent.
// Variables are interpolated into SystemPrompt and Instructions using {{variable_name}} syntax.
type AgentVariable struct {
	Name        string       `json:"name"`                  // Slug used in templates: {{name}}
	Label       string       `json:"label"`                 // Human-readable label
	Type        VariableType `json:"type"`                  // Input field type
	Description string       `json:"description,omitempty"` // Help text
	Required    bool         `json:"required"`
	Default     string       `json:"default,omitempty"`
	Options     []string     `json:"options,omitempty"`     // For "select" type
	MaxLength   int          `json:"max_length,omitempty"`  // For "text" / "paragraph"
}

type Agent struct {
	ID            uuid.UUID         `json:"id" db:"id"`
	Name          string            `json:"name" db:"name"`
	Description   string            `json:"description" db:"description"`
	SystemPrompt  string            `json:"system_prompt" db:"system_prompt"`
	Instructions  string            `json:"instructions" db:"instructions"`
	EngineType    string            `json:"engine_type" db:"engine_type"` // "picoclaw", "openclaw", etc.
	EngineConfig  map[string]string `json:"engine_config" db:"engine_config"`
	Tools         []string          `json:"tools" db:"tools"`
	Model         string            `json:"model" db:"model"`
	ProviderID    *uuid.UUID        `json:"provider_id,omitempty" db:"provider_id"` // FK to model_providers
	Variables     []AgentVariable   `json:"variables" db:"variables"`               // JSONB
	Strategy      AgentStrategy     `json:"strategy" db:"strategy"`
	MaxIterations int               `json:"max_iterations" db:"max_iterations"`
	Icon          string            `json:"icon" db:"icon"`         // Emoji or URL
	Color         string            `json:"color" db:"color"`       // Hex color for UI
	AvatarURL     string            `json:"avatar_url" db:"avatar_url"` // Custom image URL
	Status        AgentStatus       `json:"status" db:"status"`
	CreatedAt     time.Time         `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at" db:"updated_at"`
}

type CreateAgentRequest struct {
	Name          string            `json:"name" validate:"required,min=1,max=255"`
	Description   string            `json:"description" validate:"max=2000"`
	SystemPrompt  string            `json:"system_prompt" validate:"required"`
	Instructions  string            `json:"instructions"`
	EngineType    string            `json:"engine_type"`
	EngineConfig  map[string]string `json:"engine_config"`
	Tools         []string          `json:"tools"`
	Model         string            `json:"model" validate:"required"`
	ProviderID    *string           `json:"provider_id,omitempty"`
	Variables     []AgentVariable   `json:"variables,omitempty"`
	Strategy      AgentStrategy     `json:"strategy,omitempty"`
	MaxIterations int               `json:"max_iterations,omitempty"`
	Icon          string            `json:"icon,omitempty"`
	Color         string            `json:"color,omitempty"`
	AvatarURL     string            `json:"avatar_url,omitempty"`
}

type UpdateAgentRequest struct {
	Name          *string            `json:"name,omitempty" validate:"omitempty,min=1,max=255"`
	Description   *string            `json:"description,omitempty" validate:"omitempty,max=2000"`
	SystemPrompt  *string            `json:"system_prompt,omitempty"`
	Instructions  *string            `json:"instructions,omitempty"`
	EngineType    *string            `json:"engine_type,omitempty"`
	EngineConfig  map[string]string  `json:"engine_config,omitempty"`
	Tools         []string           `json:"tools,omitempty"`
	Model         *string            `json:"model,omitempty"`
	ProviderID    *string            `json:"provider_id,omitempty"`
	Variables     []AgentVariable    `json:"variables,omitempty"`
	Strategy      *AgentStrategy     `json:"strategy,omitempty"`
	MaxIterations *int               `json:"max_iterations,omitempty"`
	Icon          *string            `json:"icon,omitempty"`
	Color         *string            `json:"color,omitempty"`
	AvatarURL     *string            `json:"avatar_url,omitempty"`
	Status        *AgentStatus       `json:"status,omitempty" validate:"omitempty,oneof=active inactive archived"`
}

// DebugChatMessage is a simplified chat message for the debug endpoint history.
type DebugChatMessage struct {
	Role    string `json:"role"`    // "user", "assistant"
	Content string `json:"content"`
}

// DebugAgentRequest is used for the single-agent debug/preview endpoint.
type DebugAgentRequest struct {
	Inputs          map[string]string  `json:"inputs"`                     // Variable values keyed by variable name
	Message         string             `json:"message" validate:"required"`
	History         []DebugChatMessage `json:"history,omitempty"`          // Previous messages for multi-turn conversation
	ProviderIDOver  *string            `json:"provider_id,omitempty"`      // Override provider for this debug run
	ModelOverride   string             `json:"model,omitempty"`            // Override model for this debug run
	Stream          bool               `json:"stream"`                     // Whether to stream the response
}
