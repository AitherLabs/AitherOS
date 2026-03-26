package store

import (
	"context"
	"fmt"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateWorkForce(ctx context.Context, req models.CreateWorkForceRequest) (*models.WorkForce, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	wf := &models.WorkForce{
		ID:                 uuid.New(),
		Name:               req.Name,
		Description:        req.Description,
		Objective:          req.Objective,
		Status:             models.WorkForceStatusDraft,
		Icon:               req.Icon,
		Color:              req.Color,
		BudgetTokens:       req.BudgetTokens,
		BudgetTimeS:        req.BudgetTimeS,
		AutonomousMode:     false,
		HeartbeatIntervalM: 30,
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
	}

	if wf.Icon == "" {
		wf.Icon = "\U0001F465"
	}
	if wf.Color == "" {
		wf.Color = "#9A66FF"
	}

	// Resolve optional leader_agent_id from request
	if req.LeaderAgentID != "" {
		if lid, err2 := uuid.Parse(req.LeaderAgentID); err2 == nil {
			wf.LeaderAgentID = &lid
		}
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO workforces (id, name, description, objective, status, icon, color, avatar_url, budget_tokens, budget_time_s, leader_agent_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		wf.ID, wf.Name, wf.Description, wf.Objective, wf.Status,
		wf.Icon, wf.Color, wf.AvatarURL,
		wf.BudgetTokens, wf.BudgetTimeS, wf.LeaderAgentID, wf.CreatedAt, wf.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert workforce: %w", err)
	}

	for _, aidStr := range req.AgentIDs {
		aid, err := uuid.Parse(aidStr)
		if err != nil {
			return nil, fmt.Errorf("invalid agent_id %q: %w", aidStr, err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO workforce_agents (workforce_id, agent_id, role_in_workforce)
			VALUES ($1, $2, $3)`,
			wf.ID, aid, "member",
		)
		if err != nil {
			return nil, fmt.Errorf("insert workforce_agent: %w", err)
		}
		wf.AgentIDs = append(wf.AgentIDs, aid)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return wf, nil
}

func (s *Store) GetWorkForce(ctx context.Context, id uuid.UUID) (*models.WorkForce, error) {
	wf := &models.WorkForce{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, description, objective, status, icon, color, avatar_url, budget_tokens, budget_time_s, leader_agent_id, autonomous_mode, heartbeat_interval_m, created_at, updated_at
		FROM workforces WHERE id = $1`, id,
	).Scan(
		&wf.ID, &wf.Name, &wf.Description, &wf.Objective, &wf.Status,
		&wf.Icon, &wf.Color, &wf.AvatarURL,
		&wf.BudgetTokens, &wf.BudgetTimeS, &wf.LeaderAgentID,
		&wf.AutonomousMode, &wf.HeartbeatIntervalM,
		&wf.CreatedAt, &wf.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("workforce not found: %s", id)
		}
		return nil, fmt.Errorf("get workforce: %w", err)
	}

	if err := s.loadWorkForceAgentIDs(ctx, wf); err != nil {
		return nil, err
	}

	return wf, nil
}

// loadWorkForceAgentIDs populates AgentIDs for a workforce.
func (s *Store) loadWorkForceAgentIDs(ctx context.Context, wf *models.WorkForce) error {
	rows, err := s.pool.Query(ctx, `
		SELECT agent_id FROM workforce_agents WHERE workforce_id = $1`, wf.ID,
	)
	if err != nil {
		return fmt.Errorf("get workforce agents: %w", err)
	}
	defer rows.Close()

	wf.AgentIDs = []uuid.UUID{} // empty slice, not null
	for rows.Next() {
		var aid uuid.UUID
		if err := rows.Scan(&aid); err != nil {
			return fmt.Errorf("scan agent_id: %w", err)
		}
		wf.AgentIDs = append(wf.AgentIDs, aid)
	}
	return nil
}

// LoadWorkForceAgents populates the Agents field with full Agent objects.
func (s *Store) LoadWorkForceAgents(ctx context.Context, wf *models.WorkForce) error {
	wf.Agents = make([]*models.Agent, 0, len(wf.AgentIDs))
	for _, aid := range wf.AgentIDs {
		agent, err := s.GetAgent(ctx, aid)
		if err != nil {
			continue // skip deleted/missing agents
		}
		wf.Agents = append(wf.Agents, agent)
	}
	return nil
}

func (s *Store) ListWorkForces(ctx context.Context, limit, offset int) ([]*models.WorkForce, int, error) {
	var total int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM workforces`).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count workforces: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, objective, status, icon, color, avatar_url, budget_tokens, budget_time_s, leader_agent_id, autonomous_mode, heartbeat_interval_m, created_at, updated_at
		FROM workforces ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list workforces: %w", err)
	}
	defer rows.Close()

	var workforces []*models.WorkForce
	wfIndex := make(map[uuid.UUID]*models.WorkForce)
	for rows.Next() {
		wf := &models.WorkForce{}
		if err := rows.Scan(
			&wf.ID, &wf.Name, &wf.Description, &wf.Objective, &wf.Status,
			&wf.Icon, &wf.Color, &wf.AvatarURL,
			&wf.BudgetTokens, &wf.BudgetTimeS, &wf.LeaderAgentID,
			&wf.AutonomousMode, &wf.HeartbeatIntervalM,
			&wf.CreatedAt, &wf.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan workforce: %w", err)
		}
		wf.AgentIDs = []uuid.UUID{}
		workforces = append(workforces, wf)
		wfIndex[wf.ID] = wf
	}
	rows.Close()

	// Batch-load all agent IDs in a single query
	if len(workforces) > 0 {
		wfIDs := make([]uuid.UUID, 0, len(workforces))
		for _, wf := range workforces {
			wfIDs = append(wfIDs, wf.ID)
		}
		agRows, err := s.pool.Query(ctx,
			`SELECT workforce_id, agent_id FROM workforce_agents WHERE workforce_id = ANY($1)`, wfIDs)
		if err != nil {
			return nil, 0, fmt.Errorf("batch load agent ids: %w", err)
		}
		defer agRows.Close()
		for agRows.Next() {
			var wfID, agentID uuid.UUID
			if err := agRows.Scan(&wfID, &agentID); err != nil {
				return nil, 0, fmt.Errorf("scan workforce agent: %w", err)
			}
			if wf, ok := wfIndex[wfID]; ok {
				wf.AgentIDs = append(wf.AgentIDs, agentID)
			}
		}
	}

	return workforces, total, nil
}

func (s *Store) UpdateWorkForce(ctx context.Context, id uuid.UUID, req models.UpdateWorkForceRequest) (*models.WorkForce, error) {
	wf, err := s.GetWorkForce(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		wf.Name = *req.Name
	}
	if req.Description != nil {
		wf.Description = *req.Description
	}
	if req.Objective != nil {
		wf.Objective = *req.Objective
	}
	if req.BudgetTokens != nil {
		wf.BudgetTokens = *req.BudgetTokens
	}
	if req.BudgetTimeS != nil {
		wf.BudgetTimeS = *req.BudgetTimeS
	}
	if req.Icon != nil {
		wf.Icon = *req.Icon
	}
	if req.AutonomousMode != nil {
		wf.AutonomousMode = *req.AutonomousMode
	}
	if req.HeartbeatIntervalM != nil {
		wf.HeartbeatIntervalM = *req.HeartbeatIntervalM
	}
	if req.Color != nil {
		wf.Color = *req.Color
	}
	if req.AvatarURL != nil {
		wf.AvatarURL = *req.AvatarURL
	}
	wf.UpdatedAt = time.Now()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if req.LeaderAgentID != nil {
		if *req.LeaderAgentID == "" {
			wf.LeaderAgentID = nil
		} else if lid, err2 := uuid.Parse(*req.LeaderAgentID); err2 == nil {
			wf.LeaderAgentID = &lid
		}
	}

	_, err = tx.Exec(ctx, `
		UPDATE workforces SET name=$2, description=$3, objective=$4, icon=$5, color=$6, avatar_url=$7, budget_tokens=$8, budget_time_s=$9, leader_agent_id=$10, autonomous_mode=$11, heartbeat_interval_m=$12, updated_at=$13
		WHERE id=$1`,
		wf.ID, wf.Name, wf.Description, wf.Objective, wf.Icon, wf.Color, wf.AvatarURL, wf.BudgetTokens, wf.BudgetTimeS, wf.LeaderAgentID, wf.AutonomousMode, wf.HeartbeatIntervalM, wf.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update workforce: %w", err)
	}

	if req.AgentIDs != nil {
		_, err = tx.Exec(ctx, `DELETE FROM workforce_agents WHERE workforce_id = $1`, wf.ID)
		if err != nil {
			return nil, fmt.Errorf("delete old workforce_agents: %w", err)
		}
		wf.AgentIDs = nil
		for _, aidStr := range req.AgentIDs {
			aid, err := uuid.Parse(aidStr)
			if err != nil {
				return nil, fmt.Errorf("invalid agent_id %q: %w", aidStr, err)
			}
			_, err = tx.Exec(ctx, `
				INSERT INTO workforce_agents (workforce_id, agent_id, role_in_workforce)
				VALUES ($1, $2, $3)`, wf.ID, aid, "member",
			)
			if err != nil {
				return nil, fmt.Errorf("insert workforce_agent: %w", err)
			}
			wf.AgentIDs = append(wf.AgentIDs, aid)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return wf, nil
}

func (s *Store) DeleteWorkForce(ctx context.Context, id uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Cascade: remove all dependent data in order
	tx.Exec(ctx, `DELETE FROM messages WHERE execution_id IN (SELECT id FROM executions WHERE workforce_id = $1)`, id)
	tx.Exec(ctx, `DELETE FROM events WHERE execution_id IN (SELECT id FROM executions WHERE workforce_id = $1)`, id)
	tx.Exec(ctx, `DELETE FROM executions WHERE workforce_id = $1`, id)
	tx.Exec(ctx, `DELETE FROM workforce_mcp_servers WHERE workforce_id = $1`, id)
	tx.Exec(ctx, `DELETE FROM workforce_agents WHERE workforce_id = $1`, id)

	tag, err := tx.Exec(ctx, `DELETE FROM workforces WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete workforce: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("workforce not found: %s", id)
	}

	return tx.Commit(ctx)
}

// ListAgentWorkforceIDs returns the IDs of all workforces that contain the given agent.
func (s *Store) ListAgentWorkforceIDs(ctx context.Context, agentID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `SELECT workforce_id FROM workforce_agents WHERE agent_id = $1`, agentID)
	if err != nil {
		return nil, fmt.Errorf("list agent workforce ids: %w", err)
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func (s *Store) UpdateWorkForceStatus(ctx context.Context, id uuid.UUID, status models.WorkForceStatus) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE workforces SET status = $2, updated_at = $3 WHERE id = $1`,
		id, status, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("update workforce status: %w", err)
	}
	return nil
}
