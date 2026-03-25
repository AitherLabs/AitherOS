package models

import (
	"time"

	"github.com/google/uuid"
)

// MCPTransport defines how to connect to the MCP server.
type MCPTransport string

const (
	MCPTransportStdio          MCPTransport = "stdio"
	MCPTransportSSE            MCPTransport = "sse"
	MCPTransportStreamableHTTP MCPTransport = "streamable_http"
)

// MCPServer represents a registered MCP server that provides tools.
type MCPServer struct {
	ID          uuid.UUID            `json:"id" db:"id"`
	Name        string               `json:"name" db:"name"`
	Description string               `json:"description" db:"description"`
	Transport   MCPTransport         `json:"transport" db:"transport"`
	Command     string               `json:"command,omitempty" db:"command"`     // For stdio: executable path
	Args        []string             `json:"args,omitempty" db:"args"`           // For stdio: command arguments
	URL         string               `json:"url,omitempty" db:"url"`             // For SSE/HTTP: server URL
	Headers     map[string]string    `json:"headers,omitempty" db:"headers"`     // For SSE/HTTP: custom headers
	EnvVars     map[string]string    `json:"env_vars,omitempty" db:"env_vars"`   // Environment variables (contains secrets like tokens)
	IsEnabled   bool                 `json:"is_enabled" db:"is_enabled"`
	Tools       []MCPToolDefinition  `json:"tools,omitempty"`                    // Discovered tools (not stored in this table)
	CreatedAt   time.Time            `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time            `json:"updated_at" db:"updated_at"`
}

// MCPToolDefinition represents a tool discovered from an MCP server.
// Cached in the mcp_server_tools table after discovery.
type MCPToolDefinition struct {
	ID          uuid.UUID      `json:"id" db:"id"`
	ServerID    uuid.UUID      `json:"server_id" db:"server_id"`
	Name        string         `json:"name" db:"name"`
	Description string         `json:"description" db:"description"`
	InputSchema map[string]any `json:"input_schema" db:"input_schema"` // JSON Schema for tool parameters
	CreatedAt   time.Time      `json:"created_at" db:"created_at"`
}

// WorkforceMCPServer links an MCP server to a workforce.
type WorkforceMCPServer struct {
	WorkforceID uuid.UUID `json:"workforce_id" db:"workforce_id"`
	ServerID    uuid.UUID `json:"server_id" db:"server_id"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// AgentMCPPermission defines which tools from an MCP server an agent can use.
// If tool_name is NULL/empty, the agent has access to ALL tools from that server.
type AgentMCPPermission struct {
	ID       uuid.UUID `json:"id" db:"id"`
	AgentID  uuid.UUID `json:"agent_id" db:"agent_id"`
	ServerID uuid.UUID `json:"server_id" db:"server_id"`
	ToolName string    `json:"tool_name,omitempty" db:"tool_name"` // Empty = all tools
}

// RedactSecrets returns a copy with sensitive env_var values masked.
func (s *MCPServer) RedactSecrets() {
	if s.EnvVars == nil {
		return
	}
	redacted := make(map[string]string, len(s.EnvVars))
	for k, v := range s.EnvVars {
		if len(v) > 4 {
			redacted[k] = v[:4] + "••••••••"
		} else {
			redacted[k] = "••••••••"
		}
	}
	s.EnvVars = redacted
}

// ── Request types ──

type CreateMCPServerRequest struct {
	Name        string            `json:"name" validate:"required,min=1,max=255"`
	Description string            `json:"description"`
	Transport   MCPTransport      `json:"transport" validate:"required,oneof=stdio sse streamable_http"`
	Command     string            `json:"command,omitempty"`
	Args        []string          `json:"args,omitempty"`
	URL         string            `json:"url,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
	EnvVars     map[string]string `json:"env_vars,omitempty"`
}

type UpdateMCPServerRequest struct {
	Name        *string           `json:"name,omitempty"`
	Description *string           `json:"description,omitempty"`
	Transport   *MCPTransport     `json:"transport,omitempty"`
	Command     *string           `json:"command,omitempty"`
	Args        []string          `json:"args,omitempty"`
	URL         *string           `json:"url,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
	EnvVars     map[string]string `json:"env_vars,omitempty"`
	IsEnabled   *bool             `json:"is_enabled,omitempty"`
}

type AttachMCPServerRequest struct {
	ServerID string `json:"server_id" validate:"required"`
}

type SetAgentToolsRequest struct {
	AgentID  string   `json:"agent_id" validate:"required"`
	ServerID string   `json:"server_id" validate:"required"`
	Tools    []string `json:"tools"` // Empty = all tools from server
}
