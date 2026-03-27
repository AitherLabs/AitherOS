package models

import (
	"time"

	"github.com/google/uuid"
)

type UserRole string

const (
	UserRoleAdmin  UserRole = "admin"
	UserRoleUser   UserRole = "user"
	UserRoleViewer UserRole = "viewer"
)

type User struct {
	ID           uuid.UUID  `json:"id" db:"id"`
	Email        string     `json:"email" db:"email"`
	Username     string     `json:"username" db:"username"`
	PasswordHash string     `json:"-" db:"password_hash"` // Never serialized to JSON
	DisplayName  string     `json:"display_name" db:"display_name"`
	AvatarURL    string     `json:"avatar_url,omitempty" db:"avatar_url"`
	Role         UserRole   `json:"role" db:"role"`
	IsActive     bool       `json:"is_active" db:"is_active"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty" db:"last_login_at"`
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at" db:"updated_at"`
}

type RegisterRequest struct {
	Email             string `json:"email" validate:"required,email"`
	Username          string `json:"username" validate:"required,min=3,max=100"`
	Password          string `json:"password" validate:"required,min=8"`
	DisplayName       string `json:"display_name,omitempty"`
	RegistrationToken string `json:"registration_token,omitempty"`
}

type AdminCreateUserRequest struct {
	Email       string   `json:"email"`
	Username    string   `json:"username"`
	Password    string   `json:"password"`
	DisplayName string   `json:"display_name,omitempty"`
	Role        UserRole `json:"role,omitempty"`
}

type LoginRequest struct {
	Login    string `json:"login" validate:"required"`    // email or username
	Password string `json:"password" validate:"required"`
}

type LoginResponse struct {
	Token string `json:"token"`
	User  *User  `json:"user"`
}

type UpdateProfileRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
}
