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
	Icon        string               `json:"icon,omitempty" db:"icon"`
	AvatarURL   string               `json:"avatar_url,omitempty" db:"avatar_url"`
	Tools       []MCPToolDefinition  `json:"tools,omitempty"`                    // Discovered tools (not stored in this table)
	CreatedAt   time.Time            `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time            `json:"updated_at" db:"updated_at"`
}

// RequiredCredentials extracts credential requirements from env vars.
// Returns a list of {service, key} pairs that should be in workforce credentials.
// Pattern: SERVER_NAME + env var like "GITHUB_PERSONAL_ACCESS_TOKEN" → {service: "github", key: "token"}
func (s *MCPServer) RequiredCredentials() []CredentialRequirement {
	var reqs []CredentialRequirement
	credentialPatterns := []string{"TOKEN", "API_KEY", "SECRET", "PASSWORD", "KEY"}

	for envKey := range s.EnvVars {
		isCredential := false
		for _, pattern := range credentialPatterns {
			if contains(envKey, pattern) {
				isCredential = true
				break
			}
		}
		if isCredential {
			reqs = append(reqs, CredentialRequirement{
				Service:     normalizeService(s.Name),
				KeyName:     normalizeKeyName(envKey),
				EnvVarName:  envKey,
				Description: envKey + " for " + s.Name,
			})
		}
	}
	return reqs
}

type CredentialRequirement struct {
	Service     string `json:"service"`
	KeyName     string `json:"key_name"`
	EnvVarName  string `json:"env_var_name"`
	Description string `json:"description"`
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) &&
		(s[:len(substr)] == substr || s[len(s)-len(substr):] == substr ||
		 indexOf(s, substr) >= 0))
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func normalizeService(name string) string {
	// "GitHub" → "github", "Web Fetch" → "webfetch"
	s := ""
	for _, r := range name {
		if r >= 'A' && r <= 'Z' {
			s += string(r + 32)
		} else if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			s += string(r)
		}
	}
	return s
}

func normalizeKeyName(envVar string) string {
	// "GITHUB_PERSONAL_ACCESS_TOKEN" → "token"
	// "API_KEY" → "key"
	s := ""
	for _, r := range envVar {
		if r >= 'A' && r <= 'Z' {
			s += string(r + 32)
		} else if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			s += string(r)
		} else {
			s += "_"
		}
	}
	// Extract last meaningful word
	if contains(s, "token") {
		return "token"
	} else if contains(s, "api_key") || contains(s, "key") {
		return "api_key"
	} else if contains(s, "secret") {
		return "secret"
	} else if contains(s, "password") {
		return "password"
	}
	return s
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
	Icon        string            `json:"icon,omitempty"`
	AvatarURL   string            `json:"avatar_url,omitempty"`
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
