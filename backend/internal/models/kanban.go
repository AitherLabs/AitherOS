package models

import (
	"time"

	"github.com/google/uuid"
)

type KanbanStatus string

const (
	KanbanStatusOpen       KanbanStatus = "open"
	KanbanStatusTodo       KanbanStatus = "todo"
	KanbanStatusInProgress KanbanStatus = "in_progress"
	KanbanStatusBlocked    KanbanStatus = "blocked"
	KanbanStatusDone       KanbanStatus = "done"
)

// KanbanQAStatus records whether the post-execution review passed.
type KanbanQAStatus string

const (
	KanbanQAStatusPending     KanbanQAStatus = "pending"      // not yet evaluated
	KanbanQAStatusPassed      KanbanQAStatus = "passed"       // LLM confirmed task completed correctly
	KanbanQAStatusNeedsReview KanbanQAStatus = "needs_review" // LLM flagged issues; human should check
	KanbanQAStatusSkipped     KanbanQAStatus = "skipped"      // no acceptance criteria to evaluate
)

type KanbanTask struct {
	ID          uuid.UUID      `json:"id" db:"id"`
	WorkforceID uuid.UUID      `json:"workforce_id" db:"workforce_id"`
	Title       string         `json:"title" db:"title"`
	Description string         `json:"description" db:"description"`
	Status      KanbanStatus   `json:"status" db:"status"`
	Priority    int            `json:"priority" db:"priority"` // 0=low 1=normal 2=high 3=urgent
	AssignedTo  *uuid.UUID     `json:"assigned_to,omitempty" db:"assigned_to"`
	CreatedBy   string         `json:"created_by" db:"created_by"`
	ExecutionID *uuid.UUID     `json:"execution_id,omitempty" db:"execution_id"`
	Notes       string         `json:"notes" db:"notes"`
	Position    int            `json:"position" db:"position"`
	QAStatus    KanbanQAStatus `json:"qa_status" db:"qa_status"`
	QANotes     string         `json:"qa_notes" db:"qa_notes"`
	CreatedAt   time.Time      `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at" db:"updated_at"`
}

type CreateKanbanTaskRequest struct {
	Title       string  `json:"title" validate:"required,min=1,max=500"`
	Description string  `json:"description" validate:"max=5000"`
	Priority    int     `json:"priority" validate:"min=0,max=3"`
	AssignedTo  *string `json:"assigned_to,omitempty"`
	CreatedBy   string  `json:"created_by"` // "human" or agent name
}

type UpdateKanbanTaskRequest struct {
	Title       *string         `json:"title,omitempty" validate:"omitempty,min=1,max=500"`
	Description *string         `json:"description,omitempty"`
	Status      *KanbanStatus   `json:"status,omitempty"`
	Priority    *int            `json:"priority,omitempty" validate:"omitempty,min=0,max=3"`
	AssignedTo  *string         `json:"assigned_to,omitempty"`  // "" to clear
	ExecutionID *string         `json:"execution_id,omitempty"` // "" to clear
	Notes       *string         `json:"notes,omitempty"`
	QAStatus    *KanbanQAStatus `json:"qa_status,omitempty"`
	QANotes     *string         `json:"qa_notes,omitempty"`
}
