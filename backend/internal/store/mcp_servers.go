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

// ── MCP Servers CRUD ──

func (s *Store) CreateMCPServer(ctx context.Context, req models.CreateMCPServerRequest) (*models.MCPServer, error) {
	srv := &models.MCPServer{
		ID:          uuid.New(),
		Name:        req.Name,
		Description: req.Description,
		Transport:   req.Transport,
		Command:     req.Command,
		Args:        req.Args,
		URL:         req.URL,
		Headers:     req.Headers,
		EnvVars:     req.EnvVars,
		Icon:        req.Icon,
		AvatarURL:   req.AvatarURL,
		IsEnabled:   true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if srv.Args == nil {
		srv.Args = []string{}
	}
	if srv.Headers == nil {
		srv.Headers = make(map[string]string)
	}
	if srv.EnvVars == nil {
		srv.EnvVars = make(map[string]string)
	}
	if srv.Icon == "" {
		srv.Icon = "🔧"
	}

	argsJSON, _ := json.Marshal(srv.Args)
	headersJSON, _ := json.Marshal(srv.Headers)
	envJSON, _ := json.Marshal(srv.EnvVars)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO mcp_servers (id, name, description, transport, command, args, url, headers, env_vars, is_enabled, icon, avatar_url, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		srv.ID, srv.Name, srv.Description, srv.Transport, srv.Command,
		argsJSON, srv.URL, headersJSON, envJSON,
		srv.IsEnabled, srv.Icon, srv.AvatarURL, srv.CreatedAt, srv.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert mcp_server: %w", err)
	}
	return srv, nil
}

func (s *Store) GetMCPServer(ctx context.Context, id uuid.UUID) (*models.MCPServer, error) {
	srv := &models.MCPServer{}
	var argsJSON, headersJSON, envJSON []byte

	err := s.pool.QueryRow(ctx, `
		SELECT id, name, description, transport, command, args, url, headers, env_vars, is_enabled, icon, avatar_url, created_at, updated_at
		FROM mcp_servers WHERE id = $1`, id,
	).Scan(
		&srv.ID, &srv.Name, &srv.Description, &srv.Transport, &srv.Command,
		&argsJSON, &srv.URL, &headersJSON, &envJSON,
		&srv.IsEnabled, &srv.Icon, &srv.AvatarURL, &srv.CreatedAt, &srv.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("mcp_server not found: %s", id)
		}
		return nil, fmt.Errorf("get mcp_server: %w", err)
	}
	json.Unmarshal(argsJSON, &srv.Args)
	json.Unmarshal(headersJSON, &srv.Headers)
	json.Unmarshal(envJSON, &srv.EnvVars)
	if srv.Args == nil {
		srv.Args = []string{}
	}
	if srv.Headers == nil {
		srv.Headers = make(map[string]string)
	}
	if srv.EnvVars == nil {
		srv.EnvVars = make(map[string]string)
	}
	return srv, nil
}

func (s *Store) ListMCPServers(ctx context.Context) ([]*models.MCPServer, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, transport, command, args, url, headers, env_vars, is_enabled, icon, avatar_url, created_at, updated_at
		FROM mcp_servers ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list mcp_servers: %w", err)
	}
	defer rows.Close()

	var servers []*models.MCPServer
	for rows.Next() {
		srv := &models.MCPServer{}
		var argsJSON, headersJSON, envJSON []byte
		if err := rows.Scan(
			&srv.ID, &srv.Name, &srv.Description, &srv.Transport, &srv.Command,
			&argsJSON, &srv.URL, &headersJSON, &envJSON,
			&srv.IsEnabled, &srv.Icon, &srv.AvatarURL, &srv.CreatedAt, &srv.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan mcp_server: %w", err)
		}
		json.Unmarshal(argsJSON, &srv.Args)
		json.Unmarshal(headersJSON, &srv.Headers)
		json.Unmarshal(envJSON, &srv.EnvVars)
		if srv.Args == nil {
			srv.Args = []string{}
		}
		if srv.Headers == nil {
			srv.Headers = make(map[string]string)
		}
		if srv.EnvVars == nil {
			srv.EnvVars = make(map[string]string)
		}
		servers = append(servers, srv)
	}
	return servers, nil
}

func (s *Store) UpdateMCPServer(ctx context.Context, id uuid.UUID, req models.UpdateMCPServerRequest) (*models.MCPServer, error) {
	srv, err := s.GetMCPServer(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		srv.Name = *req.Name
	}
	if req.Description != nil {
		srv.Description = *req.Description
	}
	if req.Transport != nil {
		srv.Transport = *req.Transport
	}
	if req.Command != nil {
		srv.Command = *req.Command
	}
	if req.Args != nil {
		srv.Args = req.Args
	}
	if req.URL != nil {
		srv.URL = *req.URL
	}
	if req.Headers != nil {
		srv.Headers = req.Headers
	}
	if req.EnvVars != nil {
		srv.EnvVars = req.EnvVars
	}
	if req.IsEnabled != nil {
		srv.IsEnabled = *req.IsEnabled
	}
	srv.UpdatedAt = time.Now()

	argsJSON, _ := json.Marshal(srv.Args)
	headersJSON, _ := json.Marshal(srv.Headers)
	envJSON, _ := json.Marshal(srv.EnvVars)

	_, err = s.pool.Exec(ctx, `
		UPDATE mcp_servers SET name=$2, description=$3, transport=$4, command=$5, args=$6,
			url=$7, headers=$8, env_vars=$9, is_enabled=$10, updated_at=$11
		WHERE id=$1`,
		srv.ID, srv.Name, srv.Description, srv.Transport, srv.Command,
		argsJSON, srv.URL, headersJSON, envJSON,
		srv.IsEnabled, srv.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update mcp_server: %w", err)
	}
	return srv, nil
}

func (s *Store) DeleteMCPServer(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM mcp_servers WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete mcp_server: %w", err)
	}
	return nil
}

// ── MCP Server Tools (cached tool definitions) ──

func (s *Store) UpsertMCPServerTools(ctx context.Context, serverID uuid.UUID, tools []models.MCPToolDefinition) error {
	// Delete existing tools for this server, then insert fresh
	_, err := s.pool.Exec(ctx, `DELETE FROM mcp_server_tools WHERE server_id = $1`, serverID)
	if err != nil {
		return fmt.Errorf("clear mcp_server_tools: %w", err)
	}

	for _, tool := range tools {
		schemaJSON, _ := json.Marshal(tool.InputSchema)
		_, err := s.pool.Exec(ctx, `
			INSERT INTO mcp_server_tools (id, server_id, name, description, input_schema, created_at)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			uuid.New(), serverID, tool.Name, tool.Description, schemaJSON, time.Now(),
		)
		if err != nil {
			return fmt.Errorf("insert mcp_server_tool %s: %w", tool.Name, err)
		}
	}
	return nil
}

func (s *Store) ListMCPServerTools(ctx context.Context, serverID uuid.UUID) ([]models.MCPToolDefinition, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, server_id, name, description, input_schema, created_at
		FROM mcp_server_tools WHERE server_id = $1 ORDER BY name`, serverID)
	if err != nil {
		return nil, fmt.Errorf("list mcp_server_tools: %w", err)
	}
	defer rows.Close()

	tools := []models.MCPToolDefinition{}
	for rows.Next() {
		t := models.MCPToolDefinition{}
		var schemaJSON []byte
		if err := rows.Scan(&t.ID, &t.ServerID, &t.Name, &t.Description, &schemaJSON, &t.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan mcp_server_tool: %w", err)
		}
		json.Unmarshal(schemaJSON, &t.InputSchema)
		if t.InputSchema == nil {
			t.InputSchema = make(map[string]any)
		}
		tools = append(tools, t)
	}
	return tools, nil
}

// ── Workforce ↔ MCP Server mapping ──

func (s *Store) AttachMCPServer(ctx context.Context, workforceID, serverID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO workforce_mcp_servers (workforce_id, server_id, created_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (workforce_id, server_id) DO NOTHING`,
		workforceID, serverID, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("attach mcp_server: %w", err)
	}
	return nil
}

func (s *Store) DetachMCPServer(ctx context.Context, workforceID, serverID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM workforce_mcp_servers WHERE workforce_id = $1 AND server_id = $2`,
		workforceID, serverID,
	)
	if err != nil {
		return fmt.Errorf("detach mcp_server: %w", err)
	}
	return nil
}

func (s *Store) ListWorkforceMCPServers(ctx context.Context, workforceID uuid.UUID) ([]*models.MCPServer, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT s.id, s.name, s.description, s.transport, s.command, s.args, s.url, s.headers, s.env_vars, s.is_enabled, s.icon, s.avatar_url, s.created_at, s.updated_at
		FROM mcp_servers s
		JOIN workforce_mcp_servers ws ON ws.server_id = s.id
		WHERE ws.workforce_id = $1
		ORDER BY s.name`, workforceID)
	if err != nil {
		return nil, fmt.Errorf("list workforce mcp_servers: %w", err)
	}
	defer rows.Close()

	var servers []*models.MCPServer
	for rows.Next() {
		srv := &models.MCPServer{}
		var argsJSON, headersJSON, envJSON []byte
		if err := rows.Scan(
			&srv.ID, &srv.Name, &srv.Description, &srv.Transport, &srv.Command,
			&argsJSON, &srv.URL, &headersJSON, &envJSON,
			&srv.IsEnabled, &srv.Icon, &srv.AvatarURL, &srv.CreatedAt, &srv.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan workforce mcp_server: %w", err)
		}
		json.Unmarshal(argsJSON, &srv.Args)
		json.Unmarshal(headersJSON, &srv.Headers)
		json.Unmarshal(envJSON, &srv.EnvVars)
		if srv.Args == nil {
			srv.Args = []string{}
		}
		if srv.Headers == nil {
			srv.Headers = make(map[string]string)
		}
		if srv.EnvVars == nil {
			srv.EnvVars = make(map[string]string)
		}
		servers = append(servers, srv)
	}
	return servers, nil
}

// ── Agent MCP Permissions ──

func (s *Store) SetAgentMCPPermissions(ctx context.Context, agentID, serverID uuid.UUID, toolNames []string) error {
	// Clear existing permissions for this agent+server
	_, err := s.pool.Exec(ctx, `
		DELETE FROM agent_mcp_permissions WHERE agent_id = $1 AND server_id = $2`,
		agentID, serverID,
	)
	if err != nil {
		return fmt.Errorf("clear agent_mcp_permissions: %w", err)
	}

	if len(toolNames) == 0 {
		// Empty = grant access to ALL tools (insert a single row with empty tool_name)
		_, err := s.pool.Exec(ctx, `
			INSERT INTO agent_mcp_permissions (id, agent_id, server_id, tool_name)
			VALUES ($1, $2, $3, '')`,
			uuid.New(), agentID, serverID,
		)
		if err != nil {
			return fmt.Errorf("insert agent_mcp_permission (all): %w", err)
		}
	} else {
		// Grant access to specific tools
		for _, toolName := range toolNames {
			_, err := s.pool.Exec(ctx, `
				INSERT INTO agent_mcp_permissions (id, agent_id, server_id, tool_name)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (agent_id, server_id, tool_name) DO NOTHING`,
				uuid.New(), agentID, serverID, toolName,
			)
			if err != nil {
				return fmt.Errorf("insert agent_mcp_permission %s: %w", toolName, err)
			}
		}
	}
	return nil
}

func (s *Store) RemoveAgentMCPPermissions(ctx context.Context, agentID, serverID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM agent_mcp_permissions WHERE agent_id = $1 AND server_id = $2`,
		agentID, serverID,
	)
	if err != nil {
		return fmt.Errorf("remove agent_mcp_permissions: %w", err)
	}
	return nil
}

func (s *Store) GetAgentMCPPermissions(ctx context.Context, agentID, serverID uuid.UUID) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT tool_name FROM agent_mcp_permissions
		WHERE agent_id = $1 AND server_id = $2`, agentID, serverID)
	if err != nil {
		return nil, fmt.Errorf("get agent_mcp_permissions: %w", err)
	}
	defer rows.Close()

	var tools []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan agent_mcp_permission: %w", err)
		}
		tools = append(tools, name)
	}
	return tools, nil
}

// ListAgentAllowedTools returns the full tool definitions that an agent is allowed
// to use within a specific workforce context.
func (s *Store) ListAgentAllowedTools(ctx context.Context, workforceID, agentID uuid.UUID) ([]models.MCPToolDefinition, error) {
	// Get all MCP servers attached to the workforce
	servers, err := s.ListWorkforceMCPServers(ctx, workforceID)
	if err != nil {
		return nil, err
	}

	var allowed []models.MCPToolDefinition

	for _, srv := range servers {
		if !srv.IsEnabled {
			continue
		}

		// Check agent permissions for this server
		perms, err := s.GetAgentMCPPermissions(ctx, agentID, srv.ID)
		if err != nil {
			continue
		}
		if len(perms) == 0 {
			// No permissions set = no access
			continue
		}

		// Get cached tools for this server
		tools, err := s.ListMCPServerTools(ctx, srv.ID)
		if err != nil {
			continue
		}

		// Check if agent has "all" permission (empty tool_name)
		hasAll := false
		permSet := make(map[string]bool)
		for _, p := range perms {
			if p == "" {
				hasAll = true
				break
			}
			permSet[p] = true
		}

		for _, tool := range tools {
			if hasAll || permSet[tool.Name] {
				allowed = append(allowed, tool)
			}
		}
	}

	return allowed, nil
}

type AgentMCPServerWithTools struct {
	Server models.MCPServer            `json:"server"`
	Tools  []models.MCPToolDefinition   `json:"tools"`
}

// ListAgentMCPServersWithTools returns all MCP servers and tools that an agent
// has permissions for across all workforces they belong to.
func (s *Store) ListAgentMCPServersWithTools(ctx context.Context, agentID uuid.UUID) ([]AgentMCPServerWithTools, error) {
	// Get all workforces the agent belongs to
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT w.id
		FROM workforces w
		JOIN workforce_agents wa ON wa.workforce_id = w.id
		WHERE wa.agent_id = $1`, agentID,
	)
	if err != nil {
		return nil, fmt.Errorf("list agent workforces: %w", err)
	}
	defer rows.Close()

	var workforceIDs []uuid.UUID
	for rows.Next() {
		var wfID uuid.UUID
		if err := rows.Scan(&wfID); err != nil {
			return nil, fmt.Errorf("scan workforce id: %w", err)
		}
		workforceIDs = append(workforceIDs, wfID)
	}

	if len(workforceIDs) == 0 {
		return []AgentMCPServerWithTools{}, nil
	}

	// Get all unique MCP servers across these workforces
	seenServers := make(map[uuid.UUID]*models.MCPServer)
	for _, wfID := range workforceIDs {
		servers, err := s.ListWorkforceMCPServers(ctx, wfID)
		if err != nil {
			continue
		}
		for _, srv := range servers {
			if _, exists := seenServers[srv.ID]; !exists {
				seenServers[srv.ID] = srv
			}
		}
	}

	// For each server, get agent permissions and tools
	var result []AgentMCPServerWithTools
	for serverID, server := range seenServers {
		permissions, err := s.GetAgentMCPPermissions(ctx, agentID, serverID)
		if err != nil || len(permissions) == 0 {
			continue
		}

		allTools, err := s.ListMCPServerTools(ctx, serverID)
		if err != nil {
			continue
		}

		result = append(result, AgentMCPServerWithTools{
			Server: *server,
			Tools:  allTools,
		})
	}

	return result, nil
}
