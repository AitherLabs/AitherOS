package models

import (
	"time"

	"github.com/google/uuid"
)

// ComputeElapsedS fills the ElapsedS field from started_at / ended_at.
// Call this after scanning from the DB.
func (e *Execution) ComputeElapsedS() {
	if e.StartedAt == nil {
		e.ElapsedS = 0
		return
	}
	if e.EndedAt != nil {
		e.ElapsedS = int64(e.EndedAt.Sub(*e.StartedAt).Seconds())
	} else {
		e.ElapsedS = int64(time.Since(*e.StartedAt).Seconds())
	}
}

type ExecutionStatus string

const (
	ExecutionStatusPending   ExecutionStatus = "pending"
	ExecutionStatusPlanning  ExecutionStatus = "planning"
	ExecutionStatusAwaitingApproval ExecutionStatus = "awaiting_approval"
	ExecutionStatusRunning   ExecutionStatus = "running"
	ExecutionStatusCompleted ExecutionStatus = "completed"
	ExecutionStatusFailed    ExecutionStatus = "failed"
	ExecutionStatusHalted    ExecutionStatus = "halted"
)

// SubtaskStatus tracks the lifecycle of a single pipeline step.
type SubtaskStatus string

const (
	SubtaskPending  SubtaskStatus = "pending"
	SubtaskRunning  SubtaskStatus = "running"
	SubtaskDone     SubtaskStatus = "done"
	SubtaskBlocked  SubtaskStatus = "blocked"
	SubtaskNeedsHelp SubtaskStatus = "needs_help"
)

// ExecutionSubtask is one node in the pipeline dependency graph.
// The orchestrator runs subtasks in topological order (respecting depends_on).
type ExecutionSubtask struct {
	ID        string        `json:"id"`           // short unique label, e.g. "1", "2a"
	AgentID   uuid.UUID     `json:"agent_id"`
	AgentName string        `json:"agent_name"`
	Subtask   string        `json:"subtask"`      // natural-language description of what this agent must do
	DependsOn []string      `json:"depends_on"`   // IDs of subtasks that must complete first
	Status    SubtaskStatus `json:"status"`
	Output    string        `json:"output"`       // final content produced by the agent
	ErrorMsg  string        `json:"error_msg,omitempty"` // set when status=blocked; reason for the failure
}

type Execution struct {
	ID              uuid.UUID          `json:"id" db:"id"`
	WorkForceID     uuid.UUID          `json:"workforce_id" db:"workforce_id"`
	ProjectID       *uuid.UUID         `json:"project_id,omitempty" db:"project_id"`
	Objective       string             `json:"objective" db:"objective"`
	Strategy        string             `json:"strategy" db:"strategy"`
	Plan            []ExecutionSubtask `json:"plan" db:"plan"`
	Status          ExecutionStatus    `json:"status" db:"status"`
	Inputs          map[string]string  `json:"inputs,omitempty" db:"inputs"`
	TokensUsed      int64              `json:"tokens_used" db:"tokens_used"`
	Iterations      int                `json:"iterations" db:"iterations"`
	Title           string             `json:"title" db:"title"`
	Description     string             `json:"description" db:"description"`
	ImageURL        string             `json:"image_url" db:"image_url"`
	Result          string             `json:"result" db:"result"`
	ErrorMessage    string             `json:"error_message,omitempty" db:"error_message"`
	StartedAt       *time.Time         `json:"started_at,omitempty" db:"started_at"`
	EndedAt         *time.Time         `json:"ended_at,omitempty" db:"ended_at"`
	ElapsedS        int64              `json:"elapsed_s"`
	CreatedAt       time.Time          `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at" db:"updated_at"`
	// PendingApproval is populated by the API handler when status == awaiting_approval.
	// It is never stored in the DB.
	PendingApproval *Approval          `json:"pending_approval,omitempty" db:"-"`
}

type StartExecutionRequest struct {
	Objective string            `json:"objective" validate:"required"`
	Inputs    map[string]string `json:"inputs,omitempty"` // Variable values for agent prompt interpolation
	ProjectID *string           `json:"project_id,omitempty"`
}

type ApproveExecutionRequest struct {
	Approved bool   `json:"approved"`
	Feedback string `json:"feedback"`
}

type UpdateExecutionMetaRequest struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	ImageURL    *string `json:"image_url,omitempty"`
}
