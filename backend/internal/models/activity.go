package models

import (
	"time"

	"github.com/google/uuid"
)

type ActorType string

const (
	ActorTypeUser   ActorType = "user"
	ActorTypeAgent  ActorType = "agent"
	ActorTypeSystem ActorType = "system"
)

type ActivityEvent struct {
	ID           uuid.UUID      `json:"id" db:"id"`
	WorkforceID  *uuid.UUID     `json:"workforce_id,omitempty" db:"workforce_id"`
	ExecutionID  *uuid.UUID     `json:"execution_id,omitempty" db:"execution_id"`
	ActorType    ActorType      `json:"actor_type" db:"actor_type"`
	ActorID      string         `json:"actor_id" db:"actor_id"`
	ActorName    string         `json:"actor_name" db:"actor_name"`
	Action       string         `json:"action" db:"action"`
	ResourceType string         `json:"resource_type" db:"resource_type"`
	ResourceID   string         `json:"resource_id" db:"resource_id"`
	Summary      string         `json:"summary" db:"summary"`
	Metadata     map[string]any `json:"metadata" db:"metadata"`
	CreatedAt    time.Time      `json:"created_at" db:"created_at"`
}
