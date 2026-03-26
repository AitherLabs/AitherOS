package models

import (
	"time"

	"github.com/google/uuid"
)

// Credential stores a single service/key/value triple for a workforce.
// The Value field holds the encrypted ciphertext; API responses replace it with "****".
type Credential struct {
	ID          uuid.UUID `json:"id" db:"id"`
	WorkforceID uuid.UUID `json:"workforce_id" db:"workforce_id"`
	Service     string    `json:"service" db:"service"`
	KeyName     string    `json:"key_name" db:"key_name"`
	Value       string    `json:"value" db:"value"` // masked as "****" in responses
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type UpsertCredentialRequest struct {
	Service string `json:"service" validate:"required,min=1,max=100"`
	KeyName string `json:"key_name" validate:"required,min=1,max=100"`
	Value   string `json:"value" validate:"required,min=1"`
}
