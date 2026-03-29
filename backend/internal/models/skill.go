package models

import (
	"time"

	"github.com/google/uuid"
)

type Skill struct {
	ID          uuid.UUID `json:"id"          db:"id"`
	Name        string    `json:"name"        db:"name"`
	Slug        string    `json:"slug"        db:"slug"`
	Description string    `json:"description" db:"description"`
	Content     string    `json:"content"     db:"content"`
	Category    string    `json:"category"    db:"category"`
	Source      string    `json:"source"      db:"source"`
	Author      string    `json:"author"      db:"author"`
	RepoURL     string    `json:"repo_url"    db:"repo_url"`
	Version     string    `json:"version"     db:"version"`
	Icon        string    `json:"icon"        db:"icon"`
	Tags        []string  `json:"tags"        db:"tags"`
	CreatedAt   time.Time `json:"created_at"  db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"  db:"updated_at"`
}

type AgentSkill struct {
	AgentID    uuid.UUID `json:"agent_id"    db:"agent_id"`
	SkillID    uuid.UUID `json:"skill_id"    db:"skill_id"`
	Position   int       `json:"position"    db:"position"`
	AssignedAt time.Time `json:"assigned_at" db:"assigned_at"`
	Skill      *Skill    `json:"skill,omitempty"`
}

type AssignSkillRequest struct {
	SkillID  string `json:"skill_id" validate:"required"`
	Position int    `json:"position"`
}
