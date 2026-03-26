package store

import (
	"context"
	"fmt"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ListKanbanTasks(ctx context.Context, workforceID uuid.UUID) ([]*models.KanbanTask, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, title, description, status, priority,
		       assigned_to, created_by, execution_id, notes, position, created_at, updated_at
		FROM kanban_tasks
		WHERE workforce_id = $1
		ORDER BY position ASC, created_at ASC`, workforceID)
	if err != nil {
		return nil, fmt.Errorf("list kanban tasks: %w", err)
	}
	defer rows.Close()

	var tasks []*models.KanbanTask
	for rows.Next() {
		t := &models.KanbanTask{}
		if err := rows.Scan(
			&t.ID, &t.WorkforceID, &t.Title, &t.Description, &t.Status, &t.Priority,
			&t.AssignedTo, &t.CreatedBy, &t.ExecutionID, &t.Notes, &t.Position,
			&t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan kanban task: %w", err)
		}
		tasks = append(tasks, t)
	}
	return tasks, nil
}

func (s *Store) CreateKanbanTask(ctx context.Context, workforceID uuid.UUID, req models.CreateKanbanTaskRequest) (*models.KanbanTask, error) {
	t := &models.KanbanTask{
		ID:          uuid.New(),
		WorkforceID: workforceID,
		Title:       req.Title,
		Description: req.Description,
		Status:      models.KanbanStatusOpen,
		Priority:    req.Priority,
		CreatedBy:   req.CreatedBy,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if t.CreatedBy == "" {
		t.CreatedBy = "human"
	}
	if req.AssignedTo != nil && *req.AssignedTo != "" {
		if id, err := uuid.Parse(*req.AssignedTo); err == nil {
			t.AssignedTo = &id
		}
	}

	// Position = max existing position + 1 for this status
	var maxPos int
	s.pool.QueryRow(ctx, `SELECT COALESCE(MAX(position), -1) FROM kanban_tasks WHERE workforce_id = $1 AND status = 'open'`, workforceID).Scan(&maxPos)
	t.Position = maxPos + 1

	_, err := s.pool.Exec(ctx, `
		INSERT INTO kanban_tasks
		  (id, workforce_id, title, description, status, priority, assigned_to, created_by, notes, position, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		t.ID, t.WorkforceID, t.Title, t.Description, t.Status, t.Priority,
		t.AssignedTo, t.CreatedBy, t.Notes, t.Position, t.CreatedAt, t.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert kanban task: %w", err)
	}
	return t, nil
}

func (s *Store) GetKanbanTask(ctx context.Context, id uuid.UUID) (*models.KanbanTask, error) {
	t := &models.KanbanTask{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, workforce_id, title, description, status, priority,
		       assigned_to, created_by, execution_id, notes, position, created_at, updated_at
		FROM kanban_tasks WHERE id = $1`, id,
	).Scan(
		&t.ID, &t.WorkforceID, &t.Title, &t.Description, &t.Status, &t.Priority,
		&t.AssignedTo, &t.CreatedBy, &t.ExecutionID, &t.Notes, &t.Position,
		&t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("kanban task not found: %s", id)
		}
		return nil, fmt.Errorf("get kanban task: %w", err)
	}
	return t, nil
}

func (s *Store) UpdateKanbanTask(ctx context.Context, id uuid.UUID, req models.UpdateKanbanTaskRequest) (*models.KanbanTask, error) {
	t, err := s.GetKanbanTask(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.Title != nil {
		t.Title = *req.Title
	}
	if req.Description != nil {
		t.Description = *req.Description
	}
	if req.Status != nil {
		t.Status = *req.Status
	}
	if req.Priority != nil {
		t.Priority = *req.Priority
	}
	if req.Notes != nil {
		t.Notes = *req.Notes
	}
	if req.AssignedTo != nil {
		if *req.AssignedTo == "" {
			t.AssignedTo = nil
		} else if aid, err2 := uuid.Parse(*req.AssignedTo); err2 == nil {
			t.AssignedTo = &aid
		}
	}
	if req.ExecutionID != nil {
		if *req.ExecutionID == "" {
			t.ExecutionID = nil
		} else if eid, err2 := uuid.Parse(*req.ExecutionID); err2 == nil {
			t.ExecutionID = &eid
		}
	}
	t.UpdatedAt = time.Now()

	_, err = s.pool.Exec(ctx, `
		UPDATE kanban_tasks
		SET title=$2, description=$3, status=$4, priority=$5,
		    assigned_to=$6, execution_id=$7, notes=$8, updated_at=$9
		WHERE id=$1`,
		t.ID, t.Title, t.Description, t.Status, t.Priority,
		t.AssignedTo, t.ExecutionID, t.Notes, t.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update kanban task: %w", err)
	}
	return t, nil
}

// FindKanbanTaskByExecutionID returns the kanban task linked to an execution, or nil if none.
func (s *Store) FindKanbanTaskByExecutionID(ctx context.Context, execID uuid.UUID) (*models.KanbanTask, error) {
	t := &models.KanbanTask{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, workforce_id, title, description, status, priority,
		       assigned_to, created_by, execution_id, notes, position, created_at, updated_at
		FROM kanban_tasks WHERE execution_id = $1 LIMIT 1`, execID,
	).Scan(
		&t.ID, &t.WorkforceID, &t.Title, &t.Description, &t.Status, &t.Priority,
		&t.AssignedTo, &t.CreatedBy, &t.ExecutionID, &t.Notes, &t.Position,
		&t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("find kanban task by execution: %w", err)
	}
	return t, nil
}

func (s *Store) DeleteKanbanTask(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM kanban_tasks WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete kanban task: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("kanban task not found: %s", id)
	}
	return nil
}
