package store

import (
	"context"
	"fmt"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// CreateUser registers a new user with a bcrypt-hashed password.
func (s *Store) CreateUser(ctx context.Context, req models.RegisterRequest) (*models.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	displayName := req.DisplayName
	if displayName == "" {
		displayName = req.Username
	}

	user := &models.User{
		ID:           uuid.New(),
		Email:        req.Email,
		Username:     req.Username,
		PasswordHash: string(hash),
		DisplayName:  displayName,
		Role:         models.UserRoleUser,
		IsActive:     true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO users (id, email, username, password_hash, display_name, avatar_url, role, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		user.ID, user.Email, user.Username, user.PasswordHash, user.DisplayName,
		user.AvatarURL, user.Role, user.IsActive, user.CreatedAt, user.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}

	return user, nil
}

// Authenticate validates credentials and returns the user if valid.
func (s *Store) Authenticate(ctx context.Context, login, password string) (*models.User, error) {
	user := &models.User{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, username, password_hash, display_name, avatar_url, role, is_active, last_login_at, created_at, updated_at
		FROM users WHERE (email = $1 OR username = $1) AND is_active = true`, login,
	).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.DisplayName,
		&user.AvatarURL, &user.Role, &user.IsActive, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("invalid credentials")
		}
		return nil, fmt.Errorf("authenticate: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, fmt.Errorf("invalid credentials")
	}

	// Update last login
	now := time.Now()
	s.pool.Exec(ctx, `UPDATE users SET last_login_at = $2, updated_at = $2 WHERE id = $1`, user.ID, now)
	user.LastLoginAt = &now

	return user, nil
}

// GetUser returns a user by ID.
func (s *Store) GetUser(ctx context.Context, id uuid.UUID) (*models.User, error) {
	user := &models.User{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, username, password_hash, display_name, avatar_url, role, is_active, last_login_at, created_at, updated_at
		FROM users WHERE id = $1`, id,
	).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.DisplayName,
		&user.AvatarURL, &user.Role, &user.IsActive, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("user not found: %s", id)
		}
		return nil, fmt.Errorf("get user: %w", err)
	}
	return user, nil
}

// GetUserByEmail returns a user by email.
func (s *Store) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	user := &models.User{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, username, password_hash, display_name, avatar_url, role, is_active, last_login_at, created_at, updated_at
		FROM users WHERE email = $1`, email,
	).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.DisplayName,
		&user.AvatarURL, &user.Role, &user.IsActive, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("user not found: %s", email)
		}
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return user, nil
}

// ListUsers returns all users ordered by creation date.
func (s *Store) ListUsers(ctx context.Context) ([]*models.User, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, email, username, password_hash, display_name, avatar_url, role, is_active, last_login_at, created_at, updated_at
		FROM users ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		u := &models.User{}
		if err := rows.Scan(
			&u.ID, &u.Email, &u.Username, &u.PasswordHash, &u.DisplayName,
			&u.AvatarURL, &u.Role, &u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	return users, nil
}

// AdminCreateUser creates a user with an explicit role (admin use only).
func (s *Store) AdminCreateUser(ctx context.Context, req models.AdminCreateUserRequest) (*models.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	displayName := req.DisplayName
	if displayName == "" {
		displayName = req.Username
	}
	role := req.Role
	if role == "" {
		role = models.UserRoleUser
	}

	user := &models.User{
		ID:           uuid.New(),
		Email:        req.Email,
		Username:     req.Username,
		PasswordHash: string(hash),
		DisplayName:  displayName,
		Role:         role,
		IsActive:     true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO users (id, email, username, password_hash, display_name, avatar_url, role, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		user.ID, user.Email, user.Username, user.PasswordHash, user.DisplayName,
		user.AvatarURL, user.Role, user.IsActive, user.CreatedAt, user.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}
	return user, nil
}

// SetUserActive enables or disables a user account.
func (s *Store) SetUserActive(ctx context.Context, id uuid.UUID, active bool) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1`, id, active)
	return err
}

// UpdateProfile updates a user's display name and avatar.
func (s *Store) UpdateProfile(ctx context.Context, id uuid.UUID, req models.UpdateProfileRequest) (*models.User, error) {
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.DisplayName != nil {
		user.DisplayName = *req.DisplayName
	}
	if req.AvatarURL != nil {
		user.AvatarURL = *req.AvatarURL
	}
	user.UpdatedAt = time.Now()

	_, err = s.pool.Exec(ctx, `
		UPDATE users SET display_name = $2, avatar_url = $3, updated_at = $4 WHERE id = $1`,
		user.ID, user.DisplayName, user.AvatarURL, user.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update profile: %w", err)
	}
	return user, nil
}
