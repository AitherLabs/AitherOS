package store

import (
	"context"
	"fmt"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

// ExecutionQA stores a single Q&A pair for a finished execution.
type ExecutionQA struct {
	ID          uuid.UUID `json:"id"           db:"id"`
	ExecutionID uuid.UUID `json:"execution_id" db:"execution_id"`
	Question    string    `json:"question"     db:"question"`
	Answer      string    `json:"answer"       db:"answer"`
	CreatedAt   time.Time `json:"created_at"   db:"created_at"`
}

// CreateExecutionQA persists a new Q&A pair.
func (s *Store) CreateExecutionQA(ctx context.Context, execID uuid.UUID, question, answer string) (*ExecutionQA, error) {
	qa := &ExecutionQA{
		ID:          uuid.New(),
		ExecutionID: execID,
		Question:    question,
		Answer:      answer,
		CreatedAt:   time.Now(),
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO execution_qa (id, execution_id, question, answer, created_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		qa.ID, qa.ExecutionID, qa.Question, qa.Answer, qa.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create execution qa: %w", err)
	}
	return qa, nil
}

// ListExecutionQA returns all Q&A pairs for an execution, oldest first.
func (s *Store) ListExecutionQA(ctx context.Context, execID uuid.UUID) ([]*ExecutionQA, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, execution_id, question, answer, created_at
		 FROM execution_qa WHERE execution_id = $1
		 ORDER BY created_at ASC`,
		execID,
	)
	if err != nil {
		return nil, fmt.Errorf("list execution qa: %w", err)
	}
	defer rows.Close()

	var items []*ExecutionQA
	for rows.Next() {
		qa := &ExecutionQA{}
		if err := rows.Scan(&qa.ID, &qa.ExecutionID, &qa.Question, &qa.Answer, &qa.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan execution qa: %w", err)
		}
		items = append(items, qa)
	}
	return items, nil
}

// GetExecutionAgentOutputs returns one assistant message per agent (execution phase only)
// used for building Q&A context.
func (s *Store) GetExecutionAgentOutputs(ctx context.Context, execID uuid.UUID) ([]*models.Message, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, execution_id, agent_id, agent_name, iteration, phase, role, content,
		       tokens_input, tokens_output, model, provider_id, latency_ms, tool_calls, created_at
		FROM messages
		WHERE execution_id = $1
		  AND phase = 'execution'
		  AND role = 'assistant'
		ORDER BY created_at ASC`,
		execID,
	)
	if err != nil {
		return nil, fmt.Errorf("get execution outputs: %w", err)
	}
	defer rows.Close()

	var msgs []*models.Message
	for rows.Next() {
		m := &models.Message{}
		var toolCallsJSON []byte
		if err := rows.Scan(
			&m.ID, &m.ExecutionID, &m.AgentID, &m.AgentName, &m.Iteration,
			&m.Phase, &m.Role, &m.Content, &m.TokensIn, &m.TokensOut,
			&m.Model, &m.ProviderID, &m.LatencyMs, &toolCallsJSON, &m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan execution output: %w", err)
		}
		msgs = append(msgs, m)
	}
	return msgs, nil
}
