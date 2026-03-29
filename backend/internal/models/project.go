package models

import (
	"time"

	"github.com/google/uuid"
)

type ProjectStatus string

const (
	ProjectStatusActive    ProjectStatus = "active"
	ProjectStatusPaused    ProjectStatus = "paused"
	ProjectStatusCompleted ProjectStatus = "completed"
	ProjectStatusArchived  ProjectStatus = "archived"
)

type Project struct {
	ID              uuid.UUID     `json:"id"`
	WorkforceID     uuid.UUID     `json:"workforce_id"`
	Name            string        `json:"name"`
	Description     string        `json:"description"`
	Status          ProjectStatus `json:"status"`
	Icon            string        `json:"icon"`
	Color           string        `json:"color"`
	Brief           string        `json:"brief"`
	BriefUpdatedAt  *time.Time    `json:"brief_updated_at"`
	BriefIntervalM  int           `json:"brief_interval_m"`
	CreatedAt       time.Time     `json:"created_at"`
	UpdatedAt       time.Time     `json:"updated_at"`
}

type CreateProjectRequest struct {
	Name           string `json:"name"`
	Description    string `json:"description"`
	Status         string `json:"status"`
	Icon           string `json:"icon"`
	Color          string `json:"color"`
	BriefIntervalM int    `json:"brief_interval_m"`
}

type UpdateProjectRequest struct {
	Name           *string `json:"name,omitempty"`
	Description    *string `json:"description,omitempty"`
	Status         *string `json:"status,omitempty"`
	Icon           *string `json:"icon,omitempty"`
	Color          *string `json:"color,omitempty"`
	Brief          *string `json:"brief,omitempty"`
	BriefIntervalM *int    `json:"brief_interval_m,omitempty"`
}
