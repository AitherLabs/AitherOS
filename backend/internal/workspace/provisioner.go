// Package workspace handles per-workforce workspace provisioning:
// creating the directory tree and auto-registering Aither-Tools as an MCP server.
package workspace

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/aitheros/backend/internal/mcp"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

// internalAPIURL returns the URL aither-tools should use to call back into the
// AitherOS API. Reads SERVER_PORT from the environment (same as the backend).
func internalAPIURL() string {
	if u := os.Getenv("AITHER_API_URL"); u != "" {
		return u
	}
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}
	return "http://127.0.0.1:" + port
}

const (
	WorkforcesRoot    = "/opt/AitherOS/workforces"
	aitherToolsCmd    = "node"
	aitherToolsBinary = "/opt/AitherOS/mcp-servers/aither-tools/dist/index.js"
)

// Provisioner creates workforce workspaces and wires Aither-Tools into them.
type Provisioner struct {
	store *store.Store
}

func NewProvisioner(s *store.Store) *Provisioner {
	return &Provisioner{store: s}
}

// WorkforceRoot returns the root directory for a workforce (parent of workspace/).
func WorkforceRoot(workforceName string) string {
	return filepath.Join(WorkforcesRoot, Slug(workforceName))
}

// WorkspacePath returns the canonical workspace path for a workforce name.
func WorkspacePath(workforceName string) string {
	return filepath.Join(WorkforcesRoot, Slug(workforceName), "workspace")
}

// Provision sets up the workforce directory tree and registers Aither-Tools.
// Called immediately after a workforce is created. Non-fatal: logs errors rather
// than failing the workforce creation if provisioning has issues.
func (p *Provisioner) Provision(ctx context.Context, wf *models.WorkForce) {
	if err := p.provision(ctx, wf); err != nil {
		log.Printf("workspace: provision %q failed: %v", wf.Name, err)
	}
}

func (p *Provisioner) provision(ctx context.Context, wf *models.WorkForce) error {
	slug := Slug(wf.Name)

	// ── 1. Create directory tree ──────────────────────────────────────────────
	dirs := []string{
		filepath.Join(WorkforcesRoot, slug, "workspace"),
		filepath.Join(WorkforcesRoot, slug, "notes"),
		filepath.Join(WorkforcesRoot, slug, "tools"),
		filepath.Join(WorkforcesRoot, slug, "logs"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", dir, err)
		}
	}
	workspacePath := dirs[0]
	log.Printf("workspace: created %s", filepath.Join(WorkforcesRoot, slug))

	// ── 2. Find or create Aither-Tools MCP server for this workforce ──────────
	var srv *models.MCPServer
	attached, err := p.store.ListWorkforceMCPServers(ctx, wf.ID)
	if err != nil {
		return fmt.Errorf("list attached servers: %w", err)
	}
	requiredEnv := map[string]string{
		"AITHER_WORKSPACE":      workspacePath,
		"AITHER_WORKFORCE_NAME": wf.Name,
		"AITHER_WORKFORCE_ID":   wf.ID.String(),
		"AITHER_API_URL":        internalAPIURL(),
		"AITHER_API_TOKEN":      os.Getenv("SERVICE_TOKEN"),
	}

	for _, s := range attached {
		if s.Name == "Aither-Tools" {
			srv = s
			log.Printf("workspace: Aither-Tools already attached to %q (server %s)", wf.Name, s.ID)
			break
		}
	}

	if srv == nil {
		srv, err = p.store.CreateMCPServer(ctx, models.CreateMCPServerRequest{
			Name:        "Aither-Tools",
			Description: fmt.Sprintf("Official AitherOS toolkit — %s workspace", wf.Name),
			Transport:   "stdio",
			Command:     aitherToolsCmd,
			Args:        []string{aitherToolsBinary},
			Icon:        "⚙️",
			EnvVars:     requiredEnv,
		})
		if err != nil {
			return fmt.Errorf("create mcp server: %w", err)
		}

		// ── 3. Attach server to workforce ─────────────────────────────────────
		if err := p.store.AttachMCPServer(ctx, wf.ID, srv.ID); err != nil {
			return fmt.Errorf("attach mcp server: %w", err)
		}
	} else {
		// Patch env vars on existing server — merges new keys without wiping custom additions.
		merged := make(map[string]string, len(srv.EnvVars)+len(requiredEnv))
		for k, v := range srv.EnvVars {
			merged[k] = v
		}
		for k, v := range requiredEnv {
			merged[k] = v
		}
		if _, err = p.store.UpdateMCPServer(ctx, srv.ID, models.UpdateMCPServerRequest{EnvVars: merged}); err != nil {
			log.Printf("workspace: patch env vars for %q failed (non-fatal): %v", wf.Name, err)
		}
	}

	// ── 4. Discover and cache tool definitions ────────────────────────────────
	tools, err := p.discoverTools(srv)
	if err != nil {
		log.Printf("workspace: tool discovery for %q failed (non-fatal): %v", wf.Name, err)
	} else {
		if err := p.store.UpsertMCPServerTools(ctx, srv.ID, tools); err != nil {
			log.Printf("workspace: cache tools for %q failed (non-fatal): %v", wf.Name, err)
		} else {
			log.Printf("workspace: cached %d Aither-Tools definitions for %q", len(tools), wf.Name)
		}
	}

	// ── 5. Grant all workforce agents full access to Aither-Tools ─────────────
	for _, agentID := range wf.AgentIDs {
		// Empty tool slice = all tools allowed (see store.SetAgentMCPPermissions)
		if err := p.store.SetAgentMCPPermissions(ctx, agentID, srv.ID, []string{}); err != nil {
			log.Printf("workspace: grant agent %s access failed (non-fatal): %v", agentID, err)
		}
	}

	log.Printf("workspace: provisioned Aither-Tools for %q (server %s)", wf.Name, srv.ID)
	return nil
}

// discoverTools starts aither-tools briefly to fetch its tool list, then shuts it down.
func (p *Provisioner) discoverTools(srv *models.MCPServer) ([]models.MCPToolDefinition, error) {
	client, err := mcp.NewStdioClient(srv.Command, srv.Args, srv.EnvVars)
	if err != nil {
		return nil, fmt.Errorf("start aither-tools: %w", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	return client.ListTools(ctx)
}

// Slug converts a workforce name to a safe, lowercase directory name.
// e.g. "Lexus CyberDefense" → "lexus-cyberdefense"
func Slug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, " ", "-")
	s = regexp.MustCompile(`[^a-z0-9\-_]`).ReplaceAllString(s, "")
	s = regexp.MustCompile(`-{2,}`).ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return fmt.Sprintf("workforce-%s", uuid.New().String()[:8])
	}
	return s
}
