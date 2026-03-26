package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

// SaveEvent persists a single execution event to the DB.
func (s *Store) SaveEvent(ctx context.Context, e models.Event) error {
	dataJSON, _ := json.Marshal(e.Data)
	_, err := s.pool.Exec(ctx,
		`INSERT INTO events (id, execution_id, agent_id, agent_name, type, message, data, timestamp)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (id) DO NOTHING`,
		e.ID, e.ExecutionID, e.AgentID, e.AgentName, string(e.Type), e.Message, dataJSON, e.Timestamp,
	)
	if err != nil {
		return fmt.Errorf("save event: %w", err)
	}
	return nil
}

// ListExecutionEvents returns all events for an execution ordered by timestamp ASC.
// Filters out noisy low-signal event types (agent_thinking, iteration_done, system)
// so the frontend only gets meaningful action events.
func (s *Store) ListExecutionEvents(ctx context.Context, execID uuid.UUID) ([]*models.Event, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, execution_id, agent_id, agent_name, type, message, data, timestamp
		FROM events
		WHERE execution_id = $1
		  AND type NOT IN ('agent_thinking', 'iteration_done', 'system')
		ORDER BY timestamp ASC`,
		execID,
	)
	if err != nil {
		return nil, fmt.Errorf("list execution events: %w", err)
	}
	defer rows.Close()

	var events []*models.Event
	for rows.Next() {
		e := &models.Event{}
		var dataJSON []byte
		if err := rows.Scan(
			&e.ID, &e.ExecutionID, &e.AgentID, &e.AgentName,
			&e.Type, &e.Message, &dataJSON, &e.Timestamp,
		); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		if len(dataJSON) > 0 {
			_ = json.Unmarshal(dataJSON, &e.Data)
		}
		events = append(events, e)
	}
	return events, nil
}
