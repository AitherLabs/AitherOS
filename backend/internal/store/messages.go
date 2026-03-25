package store

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

func (s *Store) CreateMessage(ctx context.Context, msg *models.Message) error {
	toolCallsJSON := models.MarshalToolCalls(msg.ToolCalls)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO messages (id, execution_id, agent_id, agent_name, iteration, phase, role, content,
			tokens_input, tokens_output, model, provider_id, latency_ms, tool_calls, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		msg.ID, msg.ExecutionID, msg.AgentID, msg.AgentName, msg.Iteration, msg.Phase,
		msg.Role, msg.Content, msg.TokensIn, msg.TokensOut,
		msg.Model, msg.ProviderID, msg.LatencyMs, toolCallsJSON, msg.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert message: %w", err)
	}
	return nil
}

func (s *Store) ListMessages(ctx context.Context, executionID uuid.UUID, limit, offset int) ([]*models.Message, int, error) {
	var total int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM messages WHERE execution_id = $1`, executionID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count messages: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, execution_id, agent_id, agent_name, iteration, phase, role, content,
			tokens_input, tokens_output, model, provider_id, latency_ms, tool_calls, created_at
		FROM messages WHERE execution_id = $1
		ORDER BY created_at ASC
		LIMIT $2 OFFSET $3`, executionID, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()

	var msgs []*models.Message
	for rows.Next() {
		m := &models.Message{}
		var toolCallsJSON []byte
		if err := rows.Scan(
			&m.ID, &m.ExecutionID, &m.AgentID, &m.AgentName, &m.Iteration, &m.Phase,
			&m.Role, &m.Content, &m.TokensIn, &m.TokensOut,
			&m.Model, &m.ProviderID, &m.LatencyMs, &toolCallsJSON, &m.CreatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan message: %w", err)
		}
		if err := json.Unmarshal(toolCallsJSON, &m.ToolCalls); err != nil {
			log.Printf("store: unmarshal tool_calls for message %s: %v", m.ID, err)
		}
		msgs = append(msgs, m)
	}

	return msgs, total, nil
}

// ListMessagesByPhase returns all assistant messages for an execution filtered by phase.
func (s *Store) ListMessagesByPhase(ctx context.Context, executionID uuid.UUID, phase string) ([]*models.Message, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, execution_id, agent_id, agent_name, iteration, phase, role, content,
			tokens_input, tokens_output, model, provider_id, latency_ms, tool_calls, created_at
		FROM messages WHERE execution_id = $1 AND phase = $2
		ORDER BY created_at ASC`, executionID, phase,
	)
	if err != nil {
		return nil, fmt.Errorf("list messages by phase: %w", err)
	}
	defer rows.Close()

	var msgs []*models.Message
	for rows.Next() {
		m := &models.Message{}
		var toolCallsJSON []byte
		if err := rows.Scan(
			&m.ID, &m.ExecutionID, &m.AgentID, &m.AgentName, &m.Iteration, &m.Phase,
			&m.Role, &m.Content, &m.TokensIn, &m.TokensOut,
			&m.Model, &m.ProviderID, &m.LatencyMs, &toolCallsJSON, &m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan message by phase: %w", err)
		}
		if err := json.Unmarshal(toolCallsJSON, &m.ToolCalls); err != nil {
			log.Printf("store: unmarshal tool_calls for message %s: %v", m.ID, err)
		}
		msgs = append(msgs, m)
	}
	return msgs, nil
}

// GetRecentMessages returns the last N messages for an execution, used for conversation memory.
func (s *Store) GetRecentMessages(ctx context.Context, executionID uuid.UUID, limit int) ([]*models.Message, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, execution_id, agent_id, agent_name, iteration, phase, role, content,
			tokens_input, tokens_output, model, provider_id, latency_ms, tool_calls, created_at
		FROM messages WHERE execution_id = $1 AND phase NOT IN ('discussion', 'peer_consultation', 'review')
		ORDER BY created_at DESC
		LIMIT $2`,
		executionID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("get recent messages: %w", err)
	}
	defer rows.Close()

	var msgs []*models.Message
	for rows.Next() {
		m := &models.Message{}
		var toolCallsJSON []byte
		if err := rows.Scan(
			&m.ID, &m.ExecutionID, &m.AgentID, &m.AgentName, &m.Iteration, &m.Phase,
			&m.Role, &m.Content, &m.TokensIn, &m.TokensOut,
			&m.Model, &m.ProviderID, &m.LatencyMs, &toolCallsJSON, &m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		if err := json.Unmarshal(toolCallsJSON, &m.ToolCalls); err != nil {
			log.Printf("store: unmarshal tool_calls for message %s: %v", m.ID, err)
		}
		msgs = append(msgs, m)
	}

	// Reverse to get chronological order
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}

	return msgs, nil
}
