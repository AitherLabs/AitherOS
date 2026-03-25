package models

import (
	"time"

	"github.com/google/uuid"
)

type ApprovalStatus string

const (
	ApprovalStatusPending  ApprovalStatus = "pending"
	ApprovalStatusApproved ApprovalStatus = "approved"
	ApprovalStatusRejected ApprovalStatus = "rejected"
	ApprovalStatusExpired  ApprovalStatus = "expired"
)

type ApprovalActionType string

const (
	ApprovalActionExecutionStart ApprovalActionType = "execution_start"
	ApprovalActionToolCall       ApprovalActionType = "tool_call"
	ApprovalActionPlanChange     ApprovalActionType = "plan_change"
	ApprovalActionCompletion     ApprovalActionType = "completion"
	ApprovalActionHalt           ApprovalActionType = "halt"
	ApprovalActionCustom         ApprovalActionType = "custom"
)

type Approval struct {
	ID            uuid.UUID          `json:"id" db:"id"`
	WorkforceID   uuid.UUID          `json:"workforce_id" db:"workforce_id"`
	ExecutionID   *uuid.UUID         `json:"execution_id,omitempty" db:"execution_id"`
	AgentID       *uuid.UUID         `json:"agent_id,omitempty" db:"agent_id"`
	ActionType    ApprovalActionType `json:"action_type" db:"action_type"`
	Title         string             `json:"title" db:"title"`
	Description   string             `json:"description" db:"description"`
	Confidence    float64            `json:"confidence" db:"confidence"`
	RubricScores  map[string]int     `json:"rubric_scores" db:"rubric_scores"`
	Payload       map[string]any     `json:"payload" db:"payload"`
	Status        ApprovalStatus     `json:"status" db:"status"`
	ReviewerNotes string             `json:"reviewer_notes" db:"reviewer_notes"`
	RequestedBy   string             `json:"requested_by" db:"requested_by"`
	ResolvedBy    string             `json:"resolved_by" db:"resolved_by"`
	CreatedAt     time.Time          `json:"created_at" db:"created_at"`
	ResolvedAt    *time.Time         `json:"resolved_at,omitempty" db:"resolved_at"`
}

type CreateApprovalRequest struct {
	ExecutionID *uuid.UUID         `json:"execution_id,omitempty"`
	AgentID     *uuid.UUID         `json:"agent_id,omitempty"`
	ActionType  ApprovalActionType `json:"action_type" validate:"required"`
	Title       string             `json:"title" validate:"required"`
	Description string             `json:"description"`
	Confidence  float64            `json:"confidence"`
	RubricScores map[string]int    `json:"rubric_scores,omitempty"`
	Payload     map[string]any     `json:"payload,omitempty"`
	RequestedBy string             `json:"requested_by"`
}

type ResolveApprovalRequest struct {
	Approved      bool   `json:"approved"`
	ReviewerNotes string `json:"reviewer_notes"`
	ResolvedBy    string `json:"resolved_by"`
}
