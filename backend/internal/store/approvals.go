package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateApproval(ctx context.Context, workforceID uuid.UUID, req *models.CreateApprovalRequest) (*models.Approval, error) {
	a := &models.Approval{
		ID:           uuid.New(),
		WorkforceID:  workforceID,
		ExecutionID:  req.ExecutionID,
		AgentID:      req.AgentID,
		ActionType:   req.ActionType,
		Title:        req.Title,
		Description:  req.Description,
		Confidence:   req.Confidence,
		RubricScores: req.RubricScores,
		Payload:      req.Payload,
		Status:       models.ApprovalStatusPending,
		RequestedBy:  req.RequestedBy,
		CreatedAt:    time.Now(),
	}
	if a.RubricScores == nil {
		a.RubricScores = make(map[string]int)
	}
	if a.Payload == nil {
		a.Payload = make(map[string]any)
	}
	if a.RequestedBy == "" {
		a.RequestedBy = "system"
	}

	rubricJSON, _ := json.Marshal(a.RubricScores)
	payloadJSON, _ := json.Marshal(a.Payload)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO approvals (id, workforce_id, execution_id, agent_id, action_type, title, description, confidence, rubric_scores, payload, status, reviewer_notes, requested_by, resolved_by, created_at, resolved_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		a.ID, a.WorkforceID, a.ExecutionID, a.AgentID,
		a.ActionType, a.Title, a.Description, a.Confidence,
		rubricJSON, payloadJSON,
		a.Status, a.ReviewerNotes, a.RequestedBy, a.ResolvedBy,
		a.CreatedAt, a.ResolvedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert approval: %w", err)
	}
	return a, nil
}

func (s *Store) GetApproval(ctx context.Context, id uuid.UUID) (*models.Approval, error) {
	a := &models.Approval{}
	var rubricJSON, payloadJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, workforce_id, execution_id, agent_id, action_type, title, description,
		       confidence, rubric_scores, payload, status, reviewer_notes, requested_by, resolved_by,
		       created_at, resolved_at
		FROM approvals WHERE id = $1`, id,
	).Scan(
		&a.ID, &a.WorkforceID, &a.ExecutionID, &a.AgentID,
		&a.ActionType, &a.Title, &a.Description,
		&a.Confidence, &rubricJSON, &payloadJSON,
		&a.Status, &a.ReviewerNotes, &a.RequestedBy, &a.ResolvedBy,
		&a.CreatedAt, &a.ResolvedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("approval not found: %s", id)
		}
		return nil, fmt.Errorf("get approval: %w", err)
	}
	json.Unmarshal(rubricJSON, &a.RubricScores)
	json.Unmarshal(payloadJSON, &a.Payload)
	return a, nil
}

func (s *Store) ListApprovals(ctx context.Context, workforceID uuid.UUID, status string, limit, offset int) ([]*models.Approval, int, error) {
	var total int
	countQuery := `SELECT COUNT(*) FROM approvals WHERE workforce_id = $1`
	countArgs := []any{workforceID}
	if status != "" {
		countQuery += ` AND status = $2`
		countArgs = append(countArgs, status)
	}
	if err := s.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count approvals: %w", err)
	}

	query := `
		SELECT id, workforce_id, execution_id, agent_id, action_type, title, description,
		       confidence, rubric_scores, payload, status, reviewer_notes, requested_by, resolved_by,
		       created_at, resolved_at
		FROM approvals WHERE workforce_id = $1`
	args := []any{workforceID}
	argIdx := 2
	if status != "" {
		query += fmt.Sprintf(` AND status = $%d`, argIdx)
		args = append(args, status)
		argIdx++
	}
	query += fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list approvals: %w", err)
	}
	defer rows.Close()

	var approvals []*models.Approval
	for rows.Next() {
		a := &models.Approval{}
		var rubricJSON, payloadJSON []byte
		if err := rows.Scan(
			&a.ID, &a.WorkforceID, &a.ExecutionID, &a.AgentID,
			&a.ActionType, &a.Title, &a.Description,
			&a.Confidence, &rubricJSON, &payloadJSON,
			&a.Status, &a.ReviewerNotes, &a.RequestedBy, &a.ResolvedBy,
			&a.CreatedAt, &a.ResolvedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan approval: %w", err)
		}
		json.Unmarshal(rubricJSON, &a.RubricScores)
		json.Unmarshal(payloadJSON, &a.Payload)
		approvals = append(approvals, a)
	}
	return approvals, total, nil
}

func (s *Store) ResolveApproval(ctx context.Context, id uuid.UUID, approved bool, reviewerNotes, resolvedBy string) (*models.Approval, error) {
	status := models.ApprovalStatusRejected
	if approved {
		status = models.ApprovalStatusApproved
	}
	now := time.Now()

	_, err := s.pool.Exec(ctx, `
		UPDATE approvals
		SET status = $2, reviewer_notes = $3, resolved_by = $4, resolved_at = $5
		WHERE id = $1 AND status = 'pending'`,
		id, status, reviewerNotes, resolvedBy, now,
	)
	if err != nil {
		return nil, fmt.Errorf("resolve approval: %w", err)
	}
	return s.GetApproval(ctx, id)
}

func (s *Store) GetPendingApprovalForExecution(ctx context.Context, executionID uuid.UUID) (*models.Approval, error) {
	a := &models.Approval{}
	var rubricJSON, payloadJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, workforce_id, execution_id, agent_id, action_type, title, description,
		       confidence, rubric_scores, payload, status, reviewer_notes, requested_by, resolved_by,
		       created_at, resolved_at
		FROM approvals
		WHERE execution_id = $1 AND status = 'pending'
		ORDER BY created_at DESC
		LIMIT 1`, executionID,
	).Scan(
		&a.ID, &a.WorkforceID, &a.ExecutionID, &a.AgentID,
		&a.ActionType, &a.Title, &a.Description,
		&a.Confidence, &rubricJSON, &payloadJSON,
		&a.Status, &a.ReviewerNotes, &a.RequestedBy, &a.ResolvedBy,
		&a.CreatedAt, &a.ResolvedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get pending approval for execution: %w", err)
	}
	json.Unmarshal(rubricJSON, &a.RubricScores)
	json.Unmarshal(payloadJSON, &a.Payload)
	return a, nil
}

func (s *Store) CountPendingApprovals(ctx context.Context, workforceID uuid.UUID) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM approvals WHERE workforce_id = $1 AND status = 'pending'`, workforceID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count pending approvals: %w", err)
	}
	return count, nil
}
