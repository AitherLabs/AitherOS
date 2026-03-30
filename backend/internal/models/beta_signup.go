package models

import (
	"time"

	"github.com/google/uuid"
)

type BetaSignup struct {
	ID        uuid.UUID `json:"id"         db:"id"`
	Email     string    `json:"email"      db:"email"`
	Name      string    `json:"name"       db:"name"`
	Company   string    `json:"company"    db:"company"`
	Message   string    `json:"message"    db:"message"`
	Status    string    `json:"status"     db:"status"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type BetaSignupRequest struct {
	Email   string `json:"email"`
	Name    string `json:"name"`
	Company string `json:"company"`
	Message string `json:"message"`
}

type BetaSignupStatusUpdate struct {
	Status string `json:"status"` // pending | approved | rejected
}
