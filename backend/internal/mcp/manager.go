package mcp

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

// Manager creates per-execution MCP sessions.
// It does NOT hold client state itself — each execution gets its own Session.
type Manager struct {
	store *store.Store
}

func NewManager(s *store.Store) *Manager {
	return &Manager{store: s}
}

// Session holds the MCP clients for a single execution.
// It is NOT shared between executions — each gets its own.
type Session struct {
	mu          sync.RWMutex
	clients     map[uuid.UUID]Client    // serverID → client (owned by this session)
	toolIndex   map[string]uuid.UUID    // toolName → serverID (built once at connect time)
	serverNames map[uuid.UUID]string    // serverID → server name (for error messages)
}

// ConnectWorkforceServers creates a new Session with connections to all enabled
// MCP servers attached to a workforce. The returned cleanup function MUST be
// called when the execution finishes to close all connections.
// extraEnv is merged into every MCP server's environment (used to inject
// provider credentials such as AITHER_IMAGE_API_KEY for media generation tools).
func (m *Manager) ConnectWorkforceServers(ctx context.Context, workforceID uuid.UUID, extraEnv map[string]string) (*Session, func(), error) {
	servers, err := m.store.ListWorkforceMCPServers(ctx, workforceID)
	if err != nil {
		return nil, func() {}, fmt.Errorf("list workforce MCP servers: %w", err)
	}

	sess := &Session{
		clients:     make(map[uuid.UUID]Client),
		toolIndex:   make(map[string]uuid.UUID),
		serverNames: make(map[uuid.UUID]string),
	}

	for _, srv := range servers {
		if !srv.IsEnabled {
			continue
		}

		// Merge extra env vars (e.g. image provider credentials) into the server env
		if len(extraEnv) > 0 {
			merged := make(map[string]string, len(srv.EnvVars)+len(extraEnv))
			for k, v := range srv.EnvVars {
				merged[k] = v
			}
			for k, v := range extraEnv {
				merged[k] = v
			}
			srv.EnvVars = merged
		}

		client, err := Connect(srv)
		if err != nil {
			log.Printf("mcp-manager: failed to connect to %s (%s): %v", srv.Name, srv.ID, err)
			continue
		}

		sess.clients[srv.ID] = client
		sess.serverNames[srv.ID] = srv.Name
		log.Printf("mcp-manager: connected to %s (%s)", srv.Name, srv.ID)

		// Cache tool→server mapping once at connect time (no DB queries during execution)
		tools, err := m.store.ListMCPServerTools(ctx, srv.ID)
		if err != nil {
			log.Printf("mcp-manager: load tools for %s: %v", srv.Name, err)
			continue
		}
		for _, t := range tools {
			sess.toolIndex[t.Name] = srv.ID
		}
	}

	cleanup := func() {
		sess.mu.Lock()
		defer sess.mu.Unlock()
		for id, c := range sess.clients {
			c.Close()
			delete(sess.clients, id)
		}
	}

	return sess, cleanup, nil
}

// ResolveAgentToolDefs returns the OpenAI-compatible tool definitions
// that an agent is allowed to use within a workforce.
func (m *Manager) ResolveAgentToolDefs(ctx context.Context, workforceID, agentID uuid.UUID) []engine.ToolDefinition {
	allowed, err := m.store.ListAgentAllowedTools(ctx, workforceID, agentID)
	if err != nil {
		log.Printf("mcp-manager: resolve tools for agent %s: %v", agentID, err)
		return nil
	}

	defs := make([]engine.ToolDefinition, 0, len(allowed))
	for _, t := range allowed {
		params := t.InputSchema
		if params == nil {
			params = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		defs = append(defs, engine.ToolDefinition{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  params,
		})
	}
	return defs
}

// ExecuteToolCall executes a tool call against the appropriate MCP server.
// Uses the cached toolIndex built at session creation — zero DB queries.
func (s *Session) ExecuteToolCall(ctx context.Context, _ uuid.UUID, toolName string, args map[string]any) (string, error) {
	s.mu.RLock()
	serverID, found := s.toolIndex[toolName]
	client := s.clients[serverID]
	serverName := s.serverNames[serverID]
	s.mu.RUnlock()

	if !found {
		return "", fmt.Errorf("tool %s not found in any connected MCP server", toolName)
	}
	if client == nil {
		return "", fmt.Errorf("no active connection to MCP server %q for tool %s", serverName, toolName)
	}

	result, err := client.CallTool(ctx, toolName, args)
	if err != nil {
		return "", fmt.Errorf("tool %s error: %w", toolName, err)
	}
	return result, nil
}
