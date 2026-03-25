package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

func (s *Store) RecordActivity(ctx context.Context, evt *models.ActivityEvent) error {
	if evt.ID == uuid.Nil {
		evt.ID = uuid.New()
	}
	if evt.CreatedAt.IsZero() {
		evt.CreatedAt = time.Now()
	}
	if evt.Metadata == nil {
		evt.Metadata = make(map[string]any)
	}

	metaJSON, _ := json.Marshal(evt.Metadata)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO activity_events (id, workforce_id, execution_id, actor_type, actor_id, actor_name, action, resource_type, resource_id, summary, metadata, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		evt.ID, evt.WorkforceID, evt.ExecutionID,
		evt.ActorType, evt.ActorID, evt.ActorName,
		evt.Action, evt.ResourceType, evt.ResourceID,
		evt.Summary, metaJSON, evt.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert activity event: %w", err)
	}
	return nil
}

func (s *Store) ListActivity(ctx context.Context, workforceID *uuid.UUID, limit, offset int) ([]*models.ActivityEvent, int, error) {
	var total int
	if workforceID != nil {
		err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM activity_events WHERE workforce_id = $1`, *workforceID).Scan(&total)
		if err != nil {
			return nil, 0, fmt.Errorf("count activity: %w", err)
		}
	} else {
		err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM activity_events`).Scan(&total)
		if err != nil {
			return nil, 0, fmt.Errorf("count activity: %w", err)
		}
	}

	var query string
	var args []any
	if workforceID != nil {
		query = `
			SELECT id, workforce_id, execution_id, actor_type, actor_id, actor_name, action, resource_type, resource_id, summary, metadata, created_at
			FROM activity_events WHERE workforce_id = $1
			ORDER BY created_at DESC LIMIT $2 OFFSET $3`
		args = []any{*workforceID, limit, offset}
	} else {
		query = `
			SELECT id, workforce_id, execution_id, actor_type, actor_id, actor_name, action, resource_type, resource_id, summary, metadata, created_at
			FROM activity_events
			ORDER BY created_at DESC LIMIT $1 OFFSET $2`
		args = []any{limit, offset}
	}

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list activity: %w", err)
	}
	defer rows.Close()

	var events []*models.ActivityEvent
	for rows.Next() {
		e := &models.ActivityEvent{}
		var metaJSON []byte
		if err := rows.Scan(
			&e.ID, &e.WorkforceID, &e.ExecutionID,
			&e.ActorType, &e.ActorID, &e.ActorName,
			&e.Action, &e.ResourceType, &e.ResourceID,
			&e.Summary, &metaJSON, &e.CreatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan activity: %w", err)
		}
		json.Unmarshal(metaJSON, &e.Metadata)
		events = append(events, e)
	}
	return events, total, nil
}
