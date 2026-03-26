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

func (s *Store) CreateAgent(ctx context.Context, req models.CreateAgentRequest) (*models.Agent, error) {
	agent := &models.Agent{
		ID:            uuid.New(),
		Name:          req.Name,
		Description:   req.Description,
		SystemPrompt:  req.SystemPrompt,
		Instructions:  req.Instructions,
		EngineType:    req.EngineType,
		EngineConfig:  req.EngineConfig,
		Tools:         req.Tools,
		Model:         req.Model,
		Variables:     req.Variables,
		Strategy:      req.Strategy,
		MaxIterations: req.MaxIterations,
		Icon:          req.Icon,
		Color:         req.Color,
		Status:        models.AgentStatusActive,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	if agent.EngineConfig == nil {
		agent.EngineConfig = make(map[string]string)
	}
	if agent.Tools == nil {
		agent.Tools = []string{}
	}
	if agent.Variables == nil {
		agent.Variables = []models.AgentVariable{}
	}
	if agent.Strategy == "" {
		agent.Strategy = models.AgentStrategySimple
	}
	if agent.MaxIterations == 0 {
		agent.MaxIterations = 10
	}

	// Parse provider_id if provided
	if req.ProviderID != nil {
		pid, err := uuid.Parse(*req.ProviderID)
		if err == nil {
			agent.ProviderID = &pid
		}
	}

	varsJSON, _ := json.Marshal(agent.Variables)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO agents (id, name, description, system_prompt, instructions, engine_type, engine_config, tools, model,
			provider_id, variables, strategy, max_iterations, icon, color, avatar_url, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
		agent.ID, agent.Name, agent.Description, agent.SystemPrompt, agent.Instructions,
		agent.EngineType, agent.EngineConfig, agent.Tools, agent.Model,
		agent.ProviderID, varsJSON, agent.Strategy, agent.MaxIterations, agent.Icon, agent.Color, agent.AvatarURL,
		agent.Status, agent.CreatedAt, agent.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert agent: %w", err)
	}

	return agent, nil
}

func (s *Store) GetAgent(ctx context.Context, id uuid.UUID) (*models.Agent, error) {
	agent := &models.Agent{}
	var varsJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, description, system_prompt, instructions, engine_type, engine_config, tools, model,
			provider_id, variables, strategy, max_iterations, icon, color, avatar_url, status, created_at, updated_at
		FROM agents WHERE id = $1`, id,
	).Scan(
		&agent.ID, &agent.Name, &agent.Description, &agent.SystemPrompt, &agent.Instructions,
		&agent.EngineType, &agent.EngineConfig, &agent.Tools, &agent.Model,
		&agent.ProviderID, &varsJSON, &agent.Strategy, &agent.MaxIterations, &agent.Icon, &agent.Color, &agent.AvatarURL,
		&agent.Status, &agent.CreatedAt, &agent.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("agent not found: %s", id)
		}
		return nil, fmt.Errorf("get agent: %w", err)
	}
	if err := json.Unmarshal(varsJSON, &agent.Variables); err != nil {
		log.Printf("store: unmarshal agent variables for %s: %v", id, err)
	}
	if agent.Variables == nil {
		agent.Variables = []models.AgentVariable{}
	}

	return agent, nil
}

// GetAgentsBatch fetches multiple agents in a single query, preserving the order of ids.
func (s *Store) GetAgentsBatch(ctx context.Context, ids []uuid.UUID) ([]*models.Agent, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, system_prompt, instructions, engine_type, engine_config, tools, model,
			provider_id, variables, strategy, max_iterations, icon, color, avatar_url, status, created_at, updated_at
		FROM agents WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("get agents batch: %w", err)
	}
	defer rows.Close()

	byID := make(map[uuid.UUID]*models.Agent, len(ids))
	for rows.Next() {
		agent := &models.Agent{}
		var varsJSON []byte
		if err := rows.Scan(
			&agent.ID, &agent.Name, &agent.Description, &agent.SystemPrompt, &agent.Instructions,
			&agent.EngineType, &agent.EngineConfig, &agent.Tools, &agent.Model,
			&agent.ProviderID, &varsJSON, &agent.Strategy, &agent.MaxIterations, &agent.Icon, &agent.Color, &agent.AvatarURL,
			&agent.Status, &agent.CreatedAt, &agent.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan agent: %w", err)
		}
		if err := json.Unmarshal(varsJSON, &agent.Variables); err != nil {
			log.Printf("store: unmarshal agent variables for %s: %v", agent.ID, err)
		}
		if agent.Variables == nil {
			agent.Variables = []models.AgentVariable{}
		}
		byID[agent.ID] = agent
	}

	// Return in the same order as ids, error on missing
	result := make([]*models.Agent, 0, len(ids))
	for _, id := range ids {
		a, ok := byID[id]
		if !ok {
			return nil, fmt.Errorf("agent not found: %s", id)
		}
		result = append(result, a)
	}
	return result, nil
}

func (s *Store) ListAgents(ctx context.Context, limit, offset int) ([]*models.Agent, int, error) {
	var total int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM agents WHERE status != 'archived'`).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count agents: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, system_prompt, instructions, engine_type, engine_config, tools, model,
			provider_id, variables, strategy, max_iterations, icon, color, avatar_url, status, created_at, updated_at
		FROM agents WHERE status != 'archived'
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2`, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list agents: %w", err)
	}
	defer rows.Close()

	var agents []*models.Agent
	for rows.Next() {
		a := &models.Agent{}
		var varsJSON []byte
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Description, &a.SystemPrompt, &a.Instructions,
			&a.EngineType, &a.EngineConfig, &a.Tools, &a.Model,
			&a.ProviderID, &varsJSON, &a.Strategy, &a.MaxIterations, &a.Icon, &a.Color, &a.AvatarURL,
			&a.Status, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan agent: %w", err)
		}
		if err := json.Unmarshal(varsJSON, &a.Variables); err != nil {
			log.Printf("store: unmarshal agent variables for %s: %v", a.ID, err)
		}
		if a.Variables == nil {
			a.Variables = []models.AgentVariable{}
		}
		agents = append(agents, a)
	}

	return agents, total, nil
}

func (s *Store) UpdateAgent(ctx context.Context, id uuid.UUID, req models.UpdateAgentRequest) (*models.Agent, error) {
	agent, err := s.GetAgent(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		agent.Name = *req.Name
	}
	if req.Description != nil {
		agent.Description = *req.Description
	}
	if req.SystemPrompt != nil {
		agent.SystemPrompt = *req.SystemPrompt
	}
	if req.Instructions != nil {
		agent.Instructions = *req.Instructions
	}
	if req.EngineType != nil {
		agent.EngineType = *req.EngineType
	}
	if req.EngineConfig != nil {
		agent.EngineConfig = req.EngineConfig
	}
	if req.Tools != nil {
		agent.Tools = req.Tools
	}
	if req.Model != nil {
		agent.Model = *req.Model
	}
	if req.Status != nil {
		agent.Status = *req.Status
	}
	if req.ProviderID != nil {
		pid, err := uuid.Parse(*req.ProviderID)
		if err == nil {
			agent.ProviderID = &pid
		}
	}
	if req.Variables != nil {
		agent.Variables = req.Variables
	}
	if req.Strategy != nil {
		agent.Strategy = *req.Strategy
	}
	if req.MaxIterations != nil {
		agent.MaxIterations = *req.MaxIterations
	}
	if req.Icon != nil {
		agent.Icon = *req.Icon
	}
	if req.Color != nil {
		agent.Color = *req.Color
	}
	if req.AvatarURL != nil {
		agent.AvatarURL = *req.AvatarURL
	}
	agent.UpdatedAt = time.Now()

	varsJSON, _ := json.Marshal(agent.Variables)

	_, err = s.pool.Exec(ctx, `
		UPDATE agents SET name=$2, description=$3, system_prompt=$4, instructions=$5,
			engine_type=$6, engine_config=$7, tools=$8, model=$9,
			provider_id=$10, variables=$11, strategy=$12, max_iterations=$13, icon=$14, color=$15,
			avatar_url=$16, status=$17, updated_at=$18
		WHERE id=$1`,
		agent.ID, agent.Name, agent.Description, agent.SystemPrompt, agent.Instructions,
		agent.EngineType, agent.EngineConfig, agent.Tools, agent.Model,
		agent.ProviderID, varsJSON, agent.Strategy, agent.MaxIterations, agent.Icon, agent.Color,
		agent.AvatarURL, agent.Status, agent.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update agent: %w", err)
	}

	return agent, nil
}

func (s *Store) DeleteAgent(ctx context.Context, id uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Remove from all workforces and MCP permissions first
	tx.Exec(ctx, `DELETE FROM workforce_agents WHERE agent_id = $1`, id)
	tx.Exec(ctx, `DELETE FROM agent_mcp_permissions WHERE agent_id = $1`, id)

	tag, err := tx.Exec(ctx, `DELETE FROM agents WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete agent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agent not found: %s", id)
	}
	return tx.Commit(ctx)
}
