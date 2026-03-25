package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// MessageRole identifies who sent the message in a conversation.
type MessageRole string

const (
	MessageRoleSystem    MessageRole = "system"
	MessageRoleUser      MessageRole = "user"
	MessageRoleAssistant MessageRole = "assistant"
	MessageRoleTool      MessageRole = "tool"
)

// Message stores a single LLM call (prompt + response) for full observability.
type Message struct {
	ID          uuid.UUID      `json:"id" db:"id"`
	ExecutionID uuid.UUID      `json:"execution_id" db:"execution_id"`
	AgentID     *uuid.UUID     `json:"agent_id,omitempty" db:"agent_id"`
	AgentName   string         `json:"agent_name" db:"agent_name"`
	Iteration   int            `json:"iteration" db:"iteration"`
	Role        MessageRole    `json:"role" db:"role"`
	Content     string         `json:"content" db:"content"`
	TokensIn    int64          `json:"tokens_input" db:"tokens_input"`
	TokensOut   int64          `json:"tokens_output" db:"tokens_output"`
	Model       string         `json:"model" db:"model"`
	ProviderID  *uuid.UUID     `json:"provider_id,omitempty" db:"provider_id"`
	LatencyMs   int64          `json:"latency_ms" db:"latency_ms"`
	ToolCalls   []ToolCallJSON `json:"tool_calls,omitempty" db:"tool_calls"`
	CreatedAt   time.Time      `json:"created_at" db:"created_at"`
}

type ToolCallJSON struct {
	Name   string         `json:"name"`
	Args   map[string]any `json:"args,omitempty"`
	Result string         `json:"result,omitempty"`
}

// MarshalToolCalls serializes tool calls for JSONB storage.
func MarshalToolCalls(tc []ToolCallJSON) []byte {
	if tc == nil {
		return []byte("[]")
	}
	b, _ := json.Marshal(tc)
	return b
}
