package store

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// autoTitle generates a short display name from the objective (first sentence, max 60 chars).
func autoTitle(objective string) string {
	s := objective
	for _, sep := range []string{"\n", ". ", "? ", "! "} {
		if i := len([]rune(s)); i > 0 {
			if j := indexStr(s, sep); j > 0 {
				s = s[:j]
				break
			}
		}
	}
	runes := []rune(s)
	if len(runes) > 60 {
		return string(runes[:57]) + "..."
	}
	return s
}

func indexStr(s, sep string) int {
	for i := 0; i <= len(s)-len(sep); i++ {
		if s[i:i+len(sep)] == sep {
			return i
		}
	}
	return -1
}

func (s *Store) CreateExecution(ctx context.Context, workforceID uuid.UUID, objective string, inputs map[string]string) (*models.Execution, error) {
	if inputs == nil {
		inputs = make(map[string]string)
	}
	exec := &models.Execution{
		ID:          uuid.New(),
		WorkForceID: workforceID,
		Objective:   objective,
		Title:       autoTitle(objective),
		Status:      models.ExecutionStatusPending,
		Inputs:      inputs,
		Plan:        []models.ExecutionSubtask{},
		TokensUsed:  0,
		Iterations:  0,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	inputsJSON, _ := json.Marshal(exec.Inputs)
	planJSON, _ := json.Marshal(exec.Plan)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO executions (id, workforce_id, objective, strategy, plan, status, inputs, tokens_used, iterations, title, description, image_url, result, error_message, started_at, ended_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
		exec.ID, exec.WorkForceID, exec.Objective, exec.Strategy, planJSON, exec.Status,
		inputsJSON, exec.TokensUsed, exec.Iterations, exec.Title, exec.Description, exec.ImageURL,
		exec.Result, exec.ErrorMessage, exec.StartedAt, exec.EndedAt, exec.CreatedAt, exec.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert execution: %w", err)
	}

	return exec, nil
}

func (s *Store) GetExecution(ctx context.Context, id uuid.UUID) (*models.Execution, error) {
	exec := &models.Execution{}
	var inputsJSON, planJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, workforce_id, project_id, objective, strategy, plan, status, inputs, tokens_used, iterations, title, description, image_url, result, error_message, started_at, ended_at, created_at, updated_at
		FROM executions WHERE id = $1`, id,
	).Scan(
		&exec.ID, &exec.WorkForceID, &exec.ProjectID, &exec.Objective, &exec.Strategy, &planJSON, &exec.Status,
		&inputsJSON, &exec.TokensUsed, &exec.Iterations, &exec.Title, &exec.Description, &exec.ImageURL,
		&exec.Result, &exec.ErrorMessage, &exec.StartedAt, &exec.EndedAt, &exec.CreatedAt, &exec.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("execution not found: %s", id)
		}
		return nil, fmt.Errorf("get execution: %w", err)
	}
	if err := json.Unmarshal(inputsJSON, &exec.Inputs); err != nil {
		log.Printf("store: unmarshal execution inputs for %s: %v", id, err)
	}
	if err := json.Unmarshal(planJSON, &exec.Plan); err != nil {
		log.Printf("store: unmarshal execution plan for %s: %v", id, err)
	}
	if exec.Plan == nil {
		exec.Plan = []models.ExecutionSubtask{}
	}
	exec.ComputeElapsedS()
	return exec, nil
}

// GetLatestExecution returns the most recent execution for a workforce, or nil if none exist.
func (s *Store) GetLatestExecution(ctx context.Context, workforceID uuid.UUID) (*models.Execution, error) {
	e := &models.Execution{}
	var inputsJSON, planJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, workforce_id, project_id, objective, strategy, plan, status, inputs, tokens_used, iterations, title, description, image_url, result, error_message, started_at, ended_at, created_at, updated_at
		FROM executions WHERE workforce_id = $1 ORDER BY created_at DESC LIMIT 1`, workforceID,
	).Scan(
		&e.ID, &e.WorkForceID, &e.ProjectID, &e.Objective, &e.Strategy, &planJSON, &e.Status,
		&inputsJSON, &e.TokensUsed, &e.Iterations, &e.Title, &e.Description, &e.ImageURL,
		&e.Result, &e.ErrorMessage, &e.StartedAt, &e.EndedAt, &e.CreatedAt, &e.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get latest execution: %w", err)
	}
	return e, nil
}

func (s *Store) ListExecutions(ctx context.Context, workforceID uuid.UUID, limit, offset int) ([]*models.Execution, int, error) {
	var total int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM executions WHERE workforce_id = $1`, workforceID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count executions: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, project_id, objective, strategy, plan, status, inputs, tokens_used, iterations, title, description, image_url, result, error_message, started_at, ended_at, created_at, updated_at
		FROM executions WHERE workforce_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, workforceID, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list executions: %w", err)
	}
	defer rows.Close()

	var execs []*models.Execution
	for rows.Next() {
		e := &models.Execution{}
		var inputsJSON, planJSON []byte
		if err := rows.Scan(
			&e.ID, &e.WorkForceID, &e.ProjectID, &e.Objective, &e.Strategy, &planJSON, &e.Status,
			&inputsJSON, &e.TokensUsed, &e.Iterations, &e.Title, &e.Description, &e.ImageURL,
			&e.Result, &e.ErrorMessage, &e.StartedAt, &e.EndedAt, &e.CreatedAt, &e.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan execution: %w", err)
		}
		if err := json.Unmarshal(inputsJSON, &e.Inputs); err != nil {
			log.Printf("store: unmarshal execution inputs for %s: %v", e.ID, err)
		}
		if err := json.Unmarshal(planJSON, &e.Plan); err != nil {
			log.Printf("store: unmarshal execution plan for %s: %v", e.ID, err)
		}
		if e.Plan == nil {
			e.Plan = []models.ExecutionSubtask{}
		}
		e.ComputeElapsedS()
		execs = append(execs, e)
	}

	return execs, total, nil
}

func (s *Store) UpdateExecutionStatus(ctx context.Context, id uuid.UUID, status models.ExecutionStatus) error {
	now := time.Now()
	var startedAt, endedAt *time.Time

	if status == models.ExecutionStatusRunning {
		startedAt = &now
	}
	if status == models.ExecutionStatusCompleted || status == models.ExecutionStatusFailed || status == models.ExecutionStatusHalted {
		endedAt = &now
	}

	query := `UPDATE executions SET status = $2, updated_at = $3`
	args := []any{id, status, now}
	argIdx := 4

	if startedAt != nil {
		query += fmt.Sprintf(", started_at = $%d", argIdx)
		args = append(args, startedAt)
		argIdx++
	}
	if endedAt != nil {
		query += fmt.Sprintf(", ended_at = $%d", argIdx)
		args = append(args, endedAt)
		argIdx++
	}
	query += " WHERE id = $1"

	_, err := s.pool.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("update execution status: %w", err)
	}
	return nil
}

func (s *Store) UpdateExecutionPlan(ctx context.Context, id uuid.UUID, plan []models.ExecutionSubtask) error {
	planJSON, _ := json.Marshal(plan)
	_, err := s.pool.Exec(ctx, `
		UPDATE executions SET plan = $2, updated_at = $3 WHERE id = $1`,
		id, planJSON, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("update execution plan: %w", err)
	}
	return nil
}

func (s *Store) UpdateExecutionStrategy(ctx context.Context, id uuid.UUID, strategy string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE executions SET strategy = $2, updated_at = $3 WHERE id = $1`,
		id, strategy, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("update execution strategy: %w", err)
	}
	return nil
}

func (s *Store) UpdateExecutionResult(ctx context.Context, id uuid.UUID, result string, tokensUsed int64, iterations int) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE executions SET result = $2, tokens_used = $3, iterations = $4, updated_at = $5 WHERE id = $1`,
		id, result, tokensUsed, iterations, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("update execution result: %w", err)
	}
	return nil
}

func (s *Store) IncrementExecutionTokens(ctx context.Context, id uuid.UUID, tokens int64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE executions SET tokens_used = tokens_used + $2, updated_at = $3 WHERE id = $1`,
		id, tokens, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("increment execution tokens: %w", err)
	}
	return nil
}

func (s *Store) UpdateExecutionMeta(ctx context.Context, id uuid.UUID, req models.UpdateExecutionMetaRequest) error {
	if req.Title == nil && req.Description == nil && req.ImageURL == nil {
		return nil
	}
	query := `UPDATE executions SET updated_at = $2`
	args := []any{id, time.Now()}
	idx := 3
	if req.Title != nil {
		query += fmt.Sprintf(", title = $%d", idx)
		args = append(args, *req.Title)
		idx++
	}
	if req.Description != nil {
		query += fmt.Sprintf(", description = $%d", idx)
		args = append(args, *req.Description)
		idx++
	}
	if req.ImageURL != nil {
		query += fmt.Sprintf(", image_url = $%d", idx)
		args = append(args, *req.ImageURL)
	}
	query += " WHERE id = $1"
	_, err := s.pool.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("update execution meta: %w", err)
	}
	return nil
}

type GlobalStats struct {
	TotalMissions int   `json:"total_missions"`
	Completed     int   `json:"completed"`
	Failed        int   `json:"failed"`
	TotalTokens   int64 `json:"total_tokens"`
}

func (s *Store) GetGlobalStats(ctx context.Context) (*GlobalStats, error) {
	st := &GlobalStats{}
	err := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*)                                        AS total_missions,
			COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
			COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
			COALESCE(SUM(tokens_used), 0)                  AS total_tokens
		FROM executions`).Scan(&st.TotalMissions, &st.Completed, &st.Failed, &st.TotalTokens)
	if err != nil {
		return nil, fmt.Errorf("get global stats: %w", err)
	}
	return st, nil
}

// TokenModelRow holds aggregated token usage for a single model.
type TokenModelRow struct {
	Model      string `json:"model"`
	ProviderID string `json:"provider_id"`
	TokensIn   int64  `json:"tokens_in"`
	TokensOut  int64  `json:"tokens_out"`
	Calls      int    `json:"calls"`
}

// GetTokenBreakdown returns per-model token usage aggregated across all messages.
func (s *Store) GetTokenBreakdown(ctx context.Context) ([]TokenModelRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			COALESCE(model, 'unknown')       AS model,
			COALESCE(provider_id::text, '')  AS provider_id,
			COALESCE(SUM(tokens_input),  0)  AS tokens_in,
			COALESCE(SUM(tokens_output), 0)  AS tokens_out,
			COUNT(*)                         AS calls
		FROM messages
		WHERE role = 'assistant'
		  AND (tokens_input > 0 OR tokens_output > 0)
		GROUP BY model, provider_id
		ORDER BY (SUM(tokens_input) + SUM(tokens_output)) DESC`)
	if err != nil {
		return nil, fmt.Errorf("get token breakdown: %w", err)
	}
	defer rows.Close()
	var result []TokenModelRow
	for rows.Next() {
		var r TokenModelRow
		if err := rows.Scan(&r.Model, &r.ProviderID, &r.TokensIn, &r.TokensOut, &r.Calls); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, nil
}

func (s *Store) DeleteExecution(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM executions WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete execution: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("execution not found")
	}
	return nil
}

type ExecutionWithWorkforce struct {
	models.Execution
	WorkforceName string `json:"workforce_name"`
}

func (s *Store) ListAllExecutions(ctx context.Context, limit, offset int) ([]*ExecutionWithWorkforce, int, error) {
	var total int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM executions`).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count executions: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			e.id, e.workforce_id, e.project_id, e.objective, e.strategy, e.plan, e.status,
			e.inputs, e.tokens_used, e.iterations, e.title, e.description,
			e.image_url, e.result, e.error_message, e.started_at, e.ended_at,
			e.created_at, e.updated_at,
			w.name AS workforce_name
		FROM executions e
		LEFT JOIN workforces w ON e.workforce_id = w.id
		ORDER BY e.created_at DESC
		LIMIT $1 OFFSET $2`, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list all executions: %w", err)
	}
	defer rows.Close()

	var execs []*ExecutionWithWorkforce
	for rows.Next() {
		e := &ExecutionWithWorkforce{}
		var inputsJSON, planJSON []byte
		var workforceName *string
		if err := rows.Scan(
			&e.ID, &e.WorkForceID, &e.ProjectID, &e.Objective, &e.Strategy, &planJSON, &e.Status,
			&inputsJSON, &e.TokensUsed, &e.Iterations, &e.Title, &e.Description, &e.ImageURL,
			&e.Result, &e.ErrorMessage, &e.StartedAt, &e.EndedAt, &e.CreatedAt, &e.UpdatedAt,
			&workforceName,
		); err != nil {
			return nil, 0, fmt.Errorf("scan execution: %w", err)
		}
		if workforceName != nil {
			e.WorkforceName = *workforceName
		}
		if err := json.Unmarshal(inputsJSON, &e.Inputs); err != nil {
			log.Printf("store: unmarshal execution inputs for %s: %v", e.ID, err)
		}
		if err := json.Unmarshal(planJSON, &e.Plan); err != nil {
			log.Printf("store: unmarshal execution plan for %s: %v", e.ID, err)
		}
		if e.Plan == nil {
			e.Plan = []models.ExecutionSubtask{}
		}
		e.ComputeElapsedS()
		execs = append(execs, e)
	}

	return execs, total, nil
}

// SetExecutionProject links an execution to a project. Called immediately after StartExecution.
func (s *Store) SetExecutionProject(ctx context.Context, execID, projectID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE executions SET project_id = $2 WHERE id = $1`, execID, projectID)
	if err != nil {
		return fmt.Errorf("set execution project: %w", err)
	}
	return nil
}

// ListExecutionsByProject returns the most recent executions for a project, newest first.
func (s *Store) ListExecutionsByProject(ctx context.Context, projectID uuid.UUID, limit int) ([]*models.Execution, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, project_id, objective, strategy, plan, status, inputs, tokens_used, iterations, title, description, image_url, result, error_message, started_at, ended_at, created_at, updated_at
		FROM executions WHERE project_id = $1
		ORDER BY created_at DESC LIMIT $2`, projectID, limit)
	if err != nil {
		return nil, fmt.Errorf("list executions by project: %w", err)
	}
	defer rows.Close()

	var execs []*models.Execution
	for rows.Next() {
		e := &models.Execution{}
		var inputsJSON, planJSON []byte
		if err := rows.Scan(
			&e.ID, &e.WorkForceID, &e.ProjectID, &e.Objective, &e.Strategy, &planJSON, &e.Status,
			&inputsJSON, &e.TokensUsed, &e.Iterations, &e.Title, &e.Description, &e.ImageURL,
			&e.Result, &e.ErrorMessage, &e.StartedAt, &e.EndedAt, &e.CreatedAt, &e.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan execution: %w", err)
		}
		json.Unmarshal(inputsJSON, &e.Inputs)
		json.Unmarshal(planJSON, &e.Plan)
		if e.Plan == nil {
			e.Plan = []models.ExecutionSubtask{}
		}
		execs = append(execs, e)
	}
	return execs, nil
}
