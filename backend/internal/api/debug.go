package api

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/mcp"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type DebugHandler struct {
	store    *store.Store
	registry *engine.ProviderRegistry
	mcpMgr   *mcp.Manager
}

func NewDebugHandler(s *store.Store, reg *engine.ProviderRegistry, mcpMgr *mcp.Manager) *DebugHandler {
	return &DebugHandler{store: s, registry: reg, mcpMgr: mcpMgr}
}

// resolveAgentToolDefs resolves MCP tool definitions for an agent across all its workforces.
func (h *DebugHandler) resolveAgentToolDefs(ctx context.Context, agentID uuid.UUID) []engine.ToolDefinition {
	if h.mcpMgr == nil {
		return nil
	}

	wfIDs, err := h.store.ListAgentWorkforceIDs(ctx, agentID)
	if err != nil || len(wfIDs) == 0 {
		return nil
	}

	seen := make(map[string]bool)
	var defs []engine.ToolDefinition
	for _, wfID := range wfIDs {
		wfDefs := h.mcpMgr.ResolveAgentToolDefs(ctx, wfID, agentID)
		for _, d := range wfDefs {
			if !seen[d.Name] {
				seen[d.Name] = true
				defs = append(defs, d)
			}
		}
	}
	return defs
}

// connectAgentMCPSessions creates MCP sessions for all workforces the agent belongs to.
// Returns the sessions, a list of workforce IDs (matching sessions by index), and a cleanup func.
func (h *DebugHandler) connectAgentMCPSessions(ctx context.Context, agentID uuid.UUID) ([]*mcp.Session, []uuid.UUID, func()) {
	if h.mcpMgr == nil {
		return nil, nil, func() {}
	}

	wfIDs, err := h.store.ListAgentWorkforceIDs(ctx, agentID)
	if err != nil || len(wfIDs) == 0 {
		return nil, nil, func() {}
	}

	var sessions []*mcp.Session
	var validWfIDs []uuid.UUID
	var cleanups []func()

	for _, wfID := range wfIDs {
		sess, cleanup, err := h.mcpMgr.ConnectWorkforceServers(ctx, wfID, nil)
		if err != nil {
			log.Printf("debug: connect MCP for workforce %s: %v", wfID, err)
			continue
		}
		sessions = append(sessions, sess)
		validWfIDs = append(validWfIDs, wfID)
		cleanups = append(cleanups, cleanup)
	}

	allCleanup := func() {
		for _, c := range cleanups {
			c()
		}
	}
	return sessions, validWfIDs, allCleanup
}

// executeToolCall tries to execute a tool call across all MCP sessions.
func (h *DebugHandler) executeToolCall(ctx context.Context, sessions []*mcp.Session, wfIDs []uuid.UUID, toolName string, args map[string]any) (string, error) {
	for i, sess := range sessions {
		result, err := sess.ExecuteToolCall(ctx, wfIDs[i], toolName, args)
		if err == nil {
			return result, nil
		}
	}
	return "", fmt.Errorf("tool %s not available in any connected MCP server", toolName)
}

// Debug handles single-agent testing without creating an execution record.
// POST /api/v1/agents/{id}/debug
func (h *DebugHandler) Debug(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent id")
		return
	}

	var req models.DebugAgentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Message == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	agent, err := h.store.GetAgent(r.Context(), agentID)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: "+err.Error())
		return
	}

	// Interpolate variables into system prompt and instructions
	systemPrompt, err := engine.InterpolatePrompt(agent.SystemPrompt, agent.Variables, req.Inputs)
	if err != nil {
		writeError(w, http.StatusBadRequest, "variable interpolation failed: "+err.Error())
		return
	}
	instructions, _ := engine.InterpolatePrompt(agent.Instructions, agent.Variables, req.Inputs)

	// Resolve the connector: check for override, then agent config, then default
	var conn engine.Connector
	modelName := agent.Model

	if req.ProviderIDOver != nil {
		pid, err := uuid.Parse(*req.ProviderIDOver)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid provider_id override")
			return
		}
		conn, modelName, err = h.registry.ResolveByProviderID(r.Context(), pid, req.ModelOverride)
		if err != nil {
			writeError(w, http.StatusBadRequest, "provider override failed: "+err.Error())
			return
		}
		if req.ModelOverride != "" {
			modelName = req.ModelOverride
		}
	} else {
		conn, modelName, err = h.registry.ResolveForAgent(r.Context(), agent)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "cannot resolve engine: "+err.Error())
			return
		}
	}

	if req.ModelOverride != "" {
		modelName = req.ModelOverride
	}

	// Resolve MCP tool definitions for this agent
	toolDefs := h.resolveAgentToolDefs(r.Context(), agentID)
	if len(toolDefs) > 0 {
		log.Printf("debug: resolved %d MCP tools for agent %s", len(toolDefs), agent.Name)
	}

	// Build conversation history from previous messages
	var history []engine.ChatMessage
	if len(req.History) > 0 {
		sysContent := systemPrompt
		if instructions != "" {
			sysContent += "\n\n## Instructions\n" + instructions
		}
		history = append(history, engine.ChatMessage{Role: "system", Content: sysContent})
		for _, msg := range req.History {
			history = append(history, engine.ChatMessage{Role: msg.Role, Content: msg.Content})
		}
		// Add current message
		history = append(history, engine.ChatMessage{Role: "user", Content: req.Message})
	}

	taskReq := engine.TaskRequest{
		AgentID:      agent.ID,
		AgentName:    agent.Name,
		SystemPrompt: systemPrompt,
		Instructions: instructions,
		Message:      req.Message,
		Model:        modelName,
		Tools:        agent.Tools,
		ToolDefs:     toolDefs,
	}

	// If we have history, use it (overrides SystemPrompt+Message in the connector)
	if len(history) > 0 {
		taskReq.History = history
	}

	// Streaming response via SSE (no tool call loop for streaming)
	if req.Stream {
		h.debugStream(w, r, conn, taskReq)
		return
	}

	// Blocking response with tool call loop
	resp, err := conn.Submit(r.Context(), taskReq)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "debug submit failed: "+err.Error())
		return
	}

	// Tool call feedback loop (if LLM requested tool calls and we have MCP tools)
	if len(resp.ToolCalls) > 0 && len(toolDefs) > 0 {
		sessions, wfIDs, cleanup := h.connectAgentMCPSessions(r.Context(), agentID)
		defer cleanup()

		if len(sessions) > 0 {
			const maxToolRounds = 5

			// Build running history for tool loop
			sysContent := systemPrompt
			if instructions != "" {
				sysContent += "\n\n## Instructions\n" + instructions
			}
			loopHistory := []engine.ChatMessage{{Role: "system", Content: sysContent}}
			if len(history) > 1 {
				// Use existing history (skip system message we just added)
				loopHistory = history
			} else {
				loopHistory = append(loopHistory, engine.ChatMessage{Role: "user", Content: req.Message})
			}

			for toolRound := 0; toolRound < maxToolRounds && len(resp.ToolCalls) > 0; toolRound++ {
				// Execute each tool call
				for i, tc := range resp.ToolCalls {
					result, toolErr := h.executeToolCall(r.Context(), sessions, wfIDs, tc.Name, tc.Args)
					if toolErr != nil {
						resp.ToolCalls[i].Result = fmt.Sprintf("Error: %s", toolErr.Error())
						log.Printf("debug: tool %s error: %v", tc.Name, toolErr)
					} else {
						resp.ToolCalls[i].Result = result
						log.Printf("debug: tool %s returned %d bytes", tc.Name, len(result))
					}
				}

				// Append assistant tool calls + tool results to history
				loopHistory = append(loopHistory, engine.ChatMessage{
					Role:      "assistant",
					Content:   resp.Content,
					ToolCalls: resp.ToolCalls,
				})
				for _, tc := range resp.ToolCalls {
					loopHistory = append(loopHistory, engine.ChatMessage{
						Role:       "tool",
						Content:    tc.Result,
						ToolCallID: tc.ID,
					})
				}

				// Re-submit with full history
				resp, err = conn.Submit(r.Context(), engine.TaskRequest{
					AgentID:   agent.ID,
					AgentName: agent.Name,
					Model:     modelName,
					Tools:     agent.Tools,
					ToolDefs:  toolDefs,
					History:   loopHistory,
				})
				if err != nil {
					log.Printf("debug: tool loop error (round %d): %v", toolRound+1, err)
					break
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *DebugHandler) debugStream(w http.ResponseWriter, r *http.Request, conn engine.Connector, taskReq engine.TaskRequest) {
	ch, err := conn.SubmitStream(r.Context(), taskReq)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "debug stream failed: "+err.Error())
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	for event := range ch {
		fmt.Fprintf(w, "data: {\"type\":%q,\"content\":%q}\n\n", event.Type, event.Content)
		flusher.Flush()
	}

	fmt.Fprintf(w, "data: [DONE]\n\n")
	flusher.Flush()
}
