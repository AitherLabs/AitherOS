package models

import (
	"time"

	"github.com/google/uuid"
)

type WorkForceStatus string

const (
	WorkForceStatusDraft     WorkForceStatus = "draft"
	WorkForceStatusPlanning  WorkForceStatus = "planning"
	WorkForceStatusAwaitingApproval WorkForceStatus = "awaiting_approval"
	WorkForceStatusExecuting WorkForceStatus = "executing"
	WorkForceStatusCompleted WorkForceStatus = "completed"
	WorkForceStatusFailed    WorkForceStatus = "failed"
	WorkForceStatusHalted    WorkForceStatus = "halted"
)

type WorkForce struct {
	ID            uuid.UUID       `json:"id" db:"id"`
	Name          string          `json:"name" db:"name"`
	Description   string          `json:"description" db:"description"`
	Objective     string          `json:"objective" db:"objective"`
	Status        WorkForceStatus `json:"status" db:"status"`
	Icon          string          `json:"icon" db:"icon"`
	Color         string          `json:"color" db:"color"`
	AvatarURL     string          `json:"avatar_url" db:"avatar_url"`
	BudgetTokens  int64           `json:"budget_tokens" db:"budget_tokens"`
	BudgetTimeS   int64           `json:"budget_time_s" db:"budget_time_s"`
	LeaderAgentID *uuid.UUID      `json:"leader_agent_id,omitempty" db:"leader_agent_id"`
	AgentIDs      []uuid.UUID     `json:"agent_ids" db:"-"`
	Agents        []*Agent        `json:"agents,omitempty" db:"-"`
	WorkspacePath string          `json:"workspace_path,omitempty" db:"-"` // computed, not stored
	CreatedAt     time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at" db:"updated_at"`
}

type WorkForceAgent struct {
	WorkForceID     uuid.UUID `json:"workforce_id" db:"workforce_id"`
	AgentID         uuid.UUID `json:"agent_id" db:"agent_id"`
	RoleInWorkForce string    `json:"role_in_workforce" db:"role_in_workforce"`
}

type CreateWorkForceRequest struct {
	Name          string  `json:"name" validate:"required,min=1,max=255"`
	Description   string  `json:"description" validate:"max=2000"`
	Objective     string  `json:"objective" validate:"required"`
	Icon          string  `json:"icon"`
	Color         string  `json:"color"`
	AvatarURL     string  `json:"avatar_url,omitempty"`
	BudgetTokens  int64   `json:"budget_tokens" validate:"min=0"`
	BudgetTimeS   int64   `json:"budget_time_s" validate:"min=0"`
	AgentIDs      []string `json:"agent_ids" validate:"required,min=1"`
	LeaderAgentID string  `json:"leader_agent_id"`
}

type UpdateWorkForceRequest struct {
	Name          *string  `json:"name,omitempty" validate:"omitempty,min=1,max=255"`
	Description   *string  `json:"description,omitempty" validate:"omitempty,max=2000"`
	Objective     *string  `json:"objective,omitempty"`
	Icon          *string  `json:"icon,omitempty"`
	Color         *string  `json:"color,omitempty"`
	AvatarURL     *string  `json:"avatar_url,omitempty"`
	BudgetTokens  *int64   `json:"budget_tokens,omitempty" validate:"omitempty,min=0"`
	BudgetTimeS   *int64   `json:"budget_time_s,omitempty" validate:"omitempty,min=0"`
	AgentIDs      []string `json:"agent_ids,omitempty"`
	LeaderAgentID *string  `json:"leader_agent_id,omitempty"`
}
