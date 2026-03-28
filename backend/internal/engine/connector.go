package engine

import (
	"context"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

// ToolDefinition is an OpenAI-compatible function tool definition.
type ToolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"` // JSON Schema
}

// ChatMessage represents a single message in a multi-turn conversation.
// Used for the tool-result feedback loop where we need to send back
// assistant tool_calls + tool results and re-submit to the LLM.
type ChatMessage struct {
	Role       string         `json:"role"`                   // "system", "user", "assistant", "tool"
	Content    string         `json:"content"`
	ToolCalls  []ToolCallInfo `json:"tool_calls,omitempty"`   // Present when role="assistant" and LLM requested tool calls
	ToolCallID string         `json:"tool_call_id,omitempty"` // Present when role="tool" (references the assistant's tool call)
}

type TaskRequest struct {
	AgentID       uuid.UUID        `json:"agent_id"`
	AgentName     string           `json:"agent_name"`
	SystemPrompt  string           `json:"system_prompt"`
	Instructions  string           `json:"instructions"`
	Message       string           `json:"message"`
	Model         string           `json:"model"`
	WorkspacePath string           `json:"workspace_path,omitempty"` // Absolute path to workforce workspace (used by image agents)
	Tools         []string         `json:"tools"`                    // Legacy: tool name strings
	ToolDefs      []ToolDefinition `json:"tool_defs"`                // Full tool definitions for OpenAI function calling
	History       []ChatMessage    `json:"history,omitempty"`        // If set, used as the full message list (overrides SystemPrompt+Message)
}

type TaskResponse struct {
	Content      string         `json:"content"`
	Reasoning    string         `json:"reasoning,omitempty"`  // Internal chain-of-thought (if available)
	TokensUsed   int64          `json:"tokens_used"`
	TokensIn     int64          `json:"tokens_input"`          // Prompt tokens
	TokensOut    int64          `json:"tokens_output"`         // Completion tokens
	Model        string         `json:"model,omitempty"`       // Actual model used
	LatencyMs    int64          `json:"latency_ms"`            // Response time in milliseconds
	ToolCalls    []ToolCallInfo `json:"tool_calls,omitempty"`
	FinishReason string         `json:"finish_reason,omitempty"` // "stop", "tool_calls", "length", etc.
	Done         bool           `json:"done"`
}

type ToolCallInfo struct {
	ID     string         `json:"id"`     // Tool call ID from the LLM (e.g. "call_abc123")
	Name   string         `json:"name"`
	Args   map[string]any `json:"args"`
	Result string         `json:"result"`
}

type StreamEvent struct {
	Type    models.EventType `json:"type"`
	Content string           `json:"content"`
	Data    map[string]any   `json:"data,omitempty"`
}

// Connector is the interface that all agent engine adapters must implement.
type Connector interface {
	// Name returns the engine type identifier.
	Name() string

	// HealthCheck verifies the engine is reachable.
	HealthCheck(ctx context.Context) error

	// Submit sends a task to the engine and returns the full response.
	Submit(ctx context.Context, req TaskRequest) (*TaskResponse, error)

	// SubmitStream sends a task and streams events back via a channel.
	SubmitStream(ctx context.Context, req TaskRequest) (<-chan StreamEvent, error)
}
