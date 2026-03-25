package models

import (
	"time"

	"github.com/google/uuid"
)

// AgentChat is a single message in an agent's persistent debug/preview chat history.
// Scoped per agent_id (and optionally user_id for future multi-tenancy).
type AgentChat struct {
	ID        uuid.UUID        `json:"id"         db:"id"`
	AgentID   uuid.UUID        `json:"agent_id"   db:"agent_id"`
	UserID    *uuid.UUID       `json:"user_id"    db:"user_id"`
	Role      string           `json:"role"       db:"role"`      // "user" | "assistant" | "error"
	Content   string           `json:"content"    db:"content"`
	ToolCalls []ToolCallJSON `json:"tool_calls" db:"tool_calls"`
	CreatedAt time.Time        `json:"created_at" db:"created_at"`
}

// CreateAgentChatRequest is the request body for POST /api/v1/agents/:id/chats
type CreateAgentChatRequest struct {
	Role      string           `json:"role"       validate:"required,oneof=user assistant error"`
	Content   string           `json:"content"    validate:"required"`
	ToolCalls []ToolCallJSON `json:"tool_calls"`
}
