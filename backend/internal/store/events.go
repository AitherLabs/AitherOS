package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

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

// ListWorkforceAgentWrittenPaths returns unique file paths referenced by
// file-writing tool calls across all executions in a workforce.
func (s *Store) ListWorkforceAgentWrittenPaths(ctx context.Context, workforceID uuid.UUID) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.data
		FROM events e
		JOIN executions x ON x.id = e.execution_id
		WHERE x.workforce_id = $1
		  AND e.type = 'tool_call'
		ORDER BY e.timestamp ASC`, workforceID)
	if err != nil {
		return nil, fmt.Errorf("list workforce tool_call events: %w", err)
	}
	defer rows.Close()

	seen := make(map[string]struct{})
	for rows.Next() {
		var dataJSON []byte
		if err := rows.Scan(&dataJSON); err != nil {
			return nil, fmt.Errorf("scan workforce tool_call event: %w", err)
		}
		if len(dataJSON) == 0 {
			continue
		}

		var payload map[string]any
		if err := json.Unmarshal(dataJSON, &payload); err != nil {
			continue
		}
		toolName, _ := payload["tool"].(string)
		args, _ := payload["args"].(map[string]any)
		for _, path := range extractToolOutputPaths(toolName, args) {
			if path == "" {
				continue
			}
			seen[path] = struct{}{}
		}
	}

	out := make([]string, 0, len(seen))
	for p := range seen {
		out = append(out, p)
	}
	sort.Strings(out)
	return out, nil
}

func extractToolOutputPaths(toolName string, args map[string]any) []string {
	if len(args) == 0 {
		return nil
	}

	tool := strings.ToLower(strings.TrimSpace(toolName))
	if !isAgentFileWriteTool(tool) {
		return nil
	}

	keys := []string{
		"path",
		"file_path",
		"output_path",
		"target_path",
		"new_path",
		"destination",
		"dest",
		"to",
		"to_path",
		"TargetFile",
		"absolute_path",
	}

	seen := make(map[string]struct{}, len(keys))
	paths := make([]string, 0, len(keys))
	for _, key := range keys {
		raw, ok := args[key]
		if !ok {
			continue
		}
		v, ok := raw.(string)
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, exists := seen[v]; exists {
			continue
		}
		seen[v] = struct{}{}
		paths = append(paths, v)
	}

	return paths
}

func isAgentFileWriteTool(tool string) bool {
	switch tool {
	case "write_file",
		"append_to_file",
		"edit_file",
		"write_to_file",
		"apply_patch",
		"edit_notebook",
		"copy_file",
		"move_file",
		"rename_file",
		"create_file":
		return true
	default:
		return false
	}
}
