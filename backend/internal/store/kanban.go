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

const kanbanSelectCols = `id, workforce_id, project_id, title, description, status, priority,
       assigned_to, created_by, execution_id, notes, position,
       qa_status, qa_notes, started_at, done_at, created_at, updated_at,
       attachments, task_refs`

func scanKanbanTask(t *models.KanbanTask, row interface{ Scan(...any) error }) error {
	var attachJSON, refsJSON []byte
	err := row.Scan(
		&t.ID, &t.WorkforceID, &t.ProjectID, &t.Title, &t.Description, &t.Status, &t.Priority,
		&t.AssignedTo, &t.CreatedBy, &t.ExecutionID, &t.Notes, &t.Position,
		&t.QAStatus, &t.QANotes, &t.StartedAt, &t.DoneAt, &t.CreatedAt, &t.UpdatedAt,
		&attachJSON, &refsJSON,
	)
	if err != nil {
		return err
	}
	if len(attachJSON) > 0 {
		_ = json.Unmarshal(attachJSON, &t.Attachments)
	}
	if len(refsJSON) > 0 {
		_ = json.Unmarshal(refsJSON, &t.TaskRefs)
	}
	if t.Attachments == nil {
		t.Attachments = []string{}
	}
	if t.TaskRefs == nil {
		t.TaskRefs = []string{}
	}
	return nil
}

func (s *Store) ListKanbanTasks(ctx context.Context, workforceID uuid.UUID) ([]*models.KanbanTask, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+kanbanSelectCols+`
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
		if err := scanKanbanTask(t, rows); err != nil {
			return nil, fmt.Errorf("scan kanban task: %w", err)
		}
		tasks = append(tasks, t)
	}
	return tasks, nil
}

// GetNextTodoKanbanTask returns the highest-priority todo task for a workforce,
// ordered by priority DESC then position ASC. Returns nil if none exists.
func (s *Store) GetNextTodoKanbanTask(ctx context.Context, workforceID uuid.UUID) (*models.KanbanTask, error) {
	t := &models.KanbanTask{}
	err := scanKanbanTask(t, s.pool.QueryRow(ctx, `
		SELECT `+kanbanSelectCols+`
		FROM kanban_tasks
		WHERE workforce_id = $1 AND status = 'todo'
		ORDER BY priority DESC, position ASC, created_at ASC
		LIMIT 1`, workforceID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get next todo task: %w", err)
	}
	return t, nil
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
		QAStatus:    models.KanbanQAStatusPending,
		Attachments: req.Attachments,
		TaskRefs:    req.TaskRefs,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if t.CreatedBy == "" {
		t.CreatedBy = "human"
	}
	if t.Attachments == nil {
		t.Attachments = []string{}
	}
	if t.TaskRefs == nil {
		t.TaskRefs = []string{}
	}
	if req.AssignedTo != nil && *req.AssignedTo != "" {
		if id, err := uuid.Parse(*req.AssignedTo); err == nil {
			t.AssignedTo = &id
		}
	}
	if req.ProjectID != nil && *req.ProjectID != "" {
		if pid, err := uuid.Parse(*req.ProjectID); err == nil {
			t.ProjectID = &pid
		}
	}

	// Position = max existing position + 1 for this status
	var maxPos int
	s.pool.QueryRow(ctx, `SELECT COALESCE(MAX(position), -1) FROM kanban_tasks WHERE workforce_id = $1 AND status = 'open'`, workforceID).Scan(&maxPos)
	t.Position = maxPos + 1

	attJSON, _ := json.Marshal(t.Attachments)
	refsJSON, _ := json.Marshal(t.TaskRefs)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO kanban_tasks
		  (id, workforce_id, project_id, title, description, status, priority, assigned_to, created_by, notes, position, qa_status, qa_notes, started_at, done_at, created_at, updated_at, attachments, task_refs)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		t.ID, t.WorkforceID, t.ProjectID, t.Title, t.Description, t.Status, t.Priority,
		t.AssignedTo, t.CreatedBy, t.Notes, t.Position, t.QAStatus, t.QANotes,
		t.StartedAt, t.DoneAt, t.CreatedAt, t.UpdatedAt,
		attJSON, refsJSON,
	)
	if err != nil {
		return nil, fmt.Errorf("insert kanban task: %w", err)
	}
	return t, nil
}

func (s *Store) GetKanbanTask(ctx context.Context, id uuid.UUID) (*models.KanbanTask, error) {
	t := &models.KanbanTask{}
	err := scanKanbanTask(t, s.pool.QueryRow(ctx, `
		SELECT `+kanbanSelectCols+`
		FROM kanban_tasks WHERE id = $1`, id))
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
		now := time.Now()
		t.Status = *req.Status
		if *req.Status == models.KanbanStatusInProgress && t.StartedAt == nil {
			t.StartedAt = &now
		}
		if *req.Status == models.KanbanStatusDone && t.DoneAt == nil {
			t.DoneAt = &now
		}
	}
	if req.Priority != nil {
		t.Priority = *req.Priority
	}
	if req.Notes != nil {
		t.Notes = *req.Notes
	}
	if req.QAStatus != nil {
		t.QAStatus = *req.QAStatus
	}
	if req.QANotes != nil {
		t.QANotes = *req.QANotes
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
	if req.ProjectID != nil {
		if *req.ProjectID == "" {
			t.ProjectID = nil
		} else if pid, err2 := uuid.Parse(*req.ProjectID); err2 == nil {
			t.ProjectID = &pid
		}
	}
	if req.Attachments != nil {
		t.Attachments = *req.Attachments
	}
	if req.TaskRefs != nil {
		t.TaskRefs = *req.TaskRefs
	}
	t.UpdatedAt = time.Now()

	attJSON, _ := json.Marshal(t.Attachments)
	refsJSON, _ := json.Marshal(t.TaskRefs)

	_, err = s.pool.Exec(ctx, `
		UPDATE kanban_tasks
		SET title=$2, description=$3, status=$4, priority=$5,
		    assigned_to=$6, execution_id=$7, notes=$8,
		    qa_status=$9, qa_notes=$10, updated_at=$11, project_id=$12,
		    started_at=$13, done_at=$14, attachments=$15, task_refs=$16
		WHERE id=$1`,
		t.ID, t.Title, t.Description, t.Status, t.Priority,
		t.AssignedTo, t.ExecutionID, t.Notes,
		t.QAStatus, t.QANotes, t.UpdatedAt, t.ProjectID,
		t.StartedAt, t.DoneAt, attJSON, refsJSON,
	)
	if err != nil {
		return nil, fmt.Errorf("update kanban task: %w", err)
	}
	return t, nil
}

// FindKanbanTaskByExecutionID returns the kanban task linked to an execution, or nil if none.
func (s *Store) FindKanbanTaskByExecutionID(ctx context.Context, execID uuid.UUID) (*models.KanbanTask, error) {
	t := &models.KanbanTask{}
	err := scanKanbanTask(t, s.pool.QueryRow(ctx, `
		SELECT `+kanbanSelectCols+`
		FROM kanban_tasks WHERE execution_id = $1 LIMIT 1`, execID))
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
