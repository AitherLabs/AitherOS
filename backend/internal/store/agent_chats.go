package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

// ListAgentChats returns all chat messages for a given agent, oldest first.
func (s *Store) ListAgentChats(ctx context.Context, agentID uuid.UUID) ([]*models.AgentChat, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, agent_id, user_id, role, content, tool_calls, created_at
		FROM agent_chats
		WHERE agent_id = $1
		ORDER BY created_at ASC`,
		agentID,
	)
	if err != nil {
		return nil, fmt.Errorf("list agent chats: %w", err)
	}
	defer rows.Close()

	var chats []*models.AgentChat
	for rows.Next() {
		c := &models.AgentChat{}
		var toolCallsJSON []byte
		if err := rows.Scan(&c.ID, &c.AgentID, &c.UserID, &c.Role, &c.Content, &toolCallsJSON, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan agent chat: %w", err)
		}
		json.Unmarshal(toolCallsJSON, &c.ToolCalls)
		if c.ToolCalls == nil {
			c.ToolCalls = []models.ToolCallJSON{}
		}
		chats = append(chats, c)
	}
	if chats == nil {
		chats = []*models.AgentChat{}
	}
	return chats, nil
}

// CreateAgentChat inserts a single chat message for an agent.
func (s *Store) CreateAgentChat(ctx context.Context, agentID uuid.UUID, userID *uuid.UUID, req models.CreateAgentChatRequest) (*models.AgentChat, error) {
	chat := &models.AgentChat{
		ID:        uuid.New(),
		AgentID:   agentID,
		UserID:    userID,
		Role:      req.Role,
		Content:   req.Content,
		ToolCalls: req.ToolCalls,
		CreatedAt: time.Now(),
	}
	if chat.ToolCalls == nil {
		chat.ToolCalls = []models.ToolCallJSON{}
	}

	toolCallsJSON := models.MarshalToolCalls(chat.ToolCalls)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO agent_chats (id, agent_id, user_id, role, content, tool_calls, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		chat.ID, chat.AgentID, chat.UserID, chat.Role, chat.Content, toolCallsJSON, chat.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert agent chat: %w", err)
	}
	return chat, nil
}

// ClearAgentChats deletes all chat messages for a given agent.
func (s *Store) ClearAgentChats(ctx context.Context, agentID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM agent_chats WHERE agent_id = $1`, agentID)
	if err != nil {
		return fmt.Errorf("clear agent chats: %w", err)
	}
	return nil
}
