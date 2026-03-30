package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

// CreateBetaSignup inserts a new beta waitlist entry. Duplicate email returns an error.
func (s *Store) CreateBetaSignup(ctx context.Context, req models.BetaSignupRequest) (*models.BetaSignup, error) {
	if req.Email == "" {
		return nil, fmt.Errorf("email is required")
	}

	entry := &models.BetaSignup{
		ID:        uuid.New(),
		Email:     strings.ToLower(strings.TrimSpace(req.Email)),
		Name:      strings.TrimSpace(req.Name),
		Company:   strings.TrimSpace(req.Company),
		Message:   strings.TrimSpace(req.Message),
		Status:    "pending",
		CreatedAt: time.Now(),
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO beta_signups (id, email, name, company, message, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		entry.ID, entry.Email, entry.Name, entry.Company, entry.Message, entry.Status, entry.CreatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			return nil, fmt.Errorf("this email is already on the waitlist")
		}
		return nil, fmt.Errorf("create beta signup: %w", err)
	}
	return entry, nil
}

// ListBetaSignups returns all waitlist entries, newest first.
func (s *Store) ListBetaSignups(ctx context.Context) ([]*models.BetaSignup, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, email, name, company, message, status, created_at
		FROM beta_signups ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list beta signups: %w", err)
	}
	defer rows.Close()

	var entries []*models.BetaSignup
	for rows.Next() {
		e := &models.BetaSignup{}
		if err := rows.Scan(&e.ID, &e.Email, &e.Name, &e.Company, &e.Message, &e.Status, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan beta signup: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// UpdateBetaSignupStatus sets the status of a waitlist entry.
func (s *Store) UpdateBetaSignupStatus(ctx context.Context, id uuid.UUID, status string) error {
	switch status {
	case "pending", "approved", "rejected":
	default:
		return fmt.Errorf("invalid status: %s", status)
	}
	_, err := s.pool.Exec(ctx, `UPDATE beta_signups SET status = $2 WHERE id = $1`, id, status)
	return err
}
