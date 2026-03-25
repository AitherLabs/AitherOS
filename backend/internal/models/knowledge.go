package models

import (
	"time"

	"github.com/google/uuid"
)

type KnowledgeSourceType string

const (
	KnowledgeSourceExecution KnowledgeSourceType = "execution_result"
	KnowledgeSourceAgent     KnowledgeSourceType = "agent_message"
	KnowledgeSourceManual    KnowledgeSourceType = "manual"
	KnowledgeSourceTool      KnowledgeSourceType = "tool_result"
)

type KnowledgeEntry struct {
	ID          uuid.UUID           `json:"id" db:"id"`
	WorkforceID uuid.UUID           `json:"workforce_id" db:"workforce_id"`
	ExecutionID *uuid.UUID          `json:"execution_id,omitempty" db:"execution_id"`
	AgentID     *uuid.UUID          `json:"agent_id,omitempty" db:"agent_id"`
	SourceType  KnowledgeSourceType `json:"source_type" db:"source_type"`
	Title       string              `json:"title" db:"title"`
	Content     string              `json:"content" db:"content"`
	Embedding   []float32           `json:"-" db:"embedding"` // Not serialized to JSON
	Metadata    map[string]any      `json:"metadata,omitempty" db:"metadata"`
	Similarity  float64             `json:"similarity,omitempty" db:"-"` // Only set on search results
	CreatedAt   time.Time           `json:"created_at" db:"created_at"`
}

type CreateKnowledgeRequest struct {
	WorkforceID string `json:"workforce_id" validate:"required"`
	Title       string `json:"title"`
	Content     string `json:"content" validate:"required"`
}

type SearchKnowledgeRequest struct {
	Query string `json:"query" validate:"required"`
	Limit int    `json:"limit"`
}
