package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/eventbus"
	"github.com/aitheros/backend/internal/knowledge"
	"github.com/aitheros/backend/internal/mcp"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/aitheros/backend/internal/workspace"
	"github.com/google/uuid"
)

// virtualSignalTools are injected into every agent's tool list so that LLMs
// which prefer function-calling over inline JSON can still trigger the
// completion/halt/peer-consultation flows correctly.
var virtualSignalTools = []engine.ToolDefinition{
	{
		Name:        "signal_complete",
		Description: "Signal that your subtask is fully complete. Call this instead of writing the JSON block manually.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"summary": map[string]any{"type": "string", "description": "Brief summary of what was accomplished"},
			},
			"required": []string{"summary"},
		},
	},
	{
		Name:        "signal_needs_help",
		Description: "Signal that you cannot proceed and need human assistance (e.g. missing credentials, ambiguous requirements). Call this instead of writing the JSON block manually.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"reason": map[string]any{"type": "string", "description": "Explain exactly what you need from the human"},
			},
			"required": []string{"reason"},
		},
	},
	{
		Name:        "signal_blocked",
		Description: "Signal that you are blocked waiting on another task or resource.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"reason": map[string]any{"type": "string", "description": "What is blocking you"},
			},
			"required": []string{"reason"},
		},
	},
	{
		Name:        "signal_ask_peer",
		Description: "Consult a peer agent with a question before continuing your subtask.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"peer":     map[string]any{"type": "string", "description": "Name of the peer agent to consult"},
				"question": map[string]any{"type": "string", "description": "The question to ask"},
			},
			"required": []string{"peer", "question"},
		},
	},
}

// handleVirtualSignalTool checks whether tc is a virtual signal tool call and,
// if so, synthesises the equivalent JSON completion signal into resp.Content
// and returns true (caller should break the tool loop).
func handleVirtualSignalTool(tc engine.ToolCallInfo, resp *engine.TaskResponse) bool {
	str := func(v any) string {
		if s, ok := v.(string); ok {
			return s
		}
		return ""
	}
	var sig string
	switch tc.Name {
	case "signal_complete":
		sig = fmt.Sprintf(`{"status":"complete","summary":%q}`, str(tc.Args["summary"]))
	case "signal_needs_help":
		sig = fmt.Sprintf(`{"status":"needs_help","reason":%q}`, str(tc.Args["reason"]))
	case "signal_blocked":
		sig = fmt.Sprintf(`{"status":"blocked","reason":%q}`, str(tc.Args["reason"]))
	case "signal_ask_peer":
		sig = fmt.Sprintf(`{"status":"ask_peer","peer":%q,"question":%q}`,
			str(tc.Args["peer"]), str(tc.Args["question"]))
	default:
		return false
	}
	resp.Content = "```json\n" + sig + "\n```"
	resp.ToolCalls = nil
	return true
}

// completionSignal is the structured JSON that agents return to signal their state.
type completionSignal struct {
	Status    string `json:"status"`    // "complete", "needs_help", "blocked", "ask_peer", or omit to continue
	Summary   string `json:"summary"`   // Final summary (when status=="complete")
	Reason    string `json:"reason"`    // Explanation for needs_help or blocked
	PeerAgent string `json:"peer"`      // Peer agent name to consult (when status=="ask_peer")
	Question  string `json:"question"`  // Question to ask the peer (when status=="ask_peer")
}

// maxConversationMemory is the number of recent messages to include as context.
const maxConversationMemory = 20

type Orchestrator struct {
	store            *store.Store
	eventBus         *eventbus.EventBus
	engines          map[string]engine.Connector
	registry         *engine.ProviderRegistry
	llmConfig        LLMConfig
	mcpManager       *mcp.Manager
	knowledgeManager *knowledge.Manager

	activeExecs          sync.Map // executionID -> *executionContext
	interventionChannels sync.Map // executionID -> chan string
}

type LLMConfig struct {
	APIBase string
	APIKey  string
	Model   string
}

type executionContext struct {
	cancel     context.CancelFunc
	tokensUsed atomic.Int64
	iterations atomic.Int32
}

// agentResult holds the output from a single agent subtask execution.
type agentResult struct {
	AgentID         uuid.UUID
	AgentName       string
	Content         string
	Tokens          int64
	Complete        bool   // Agent signaled objective is fully done
	Summary         string // Completion summary (if complete)
	NeedsHelp       bool   // Agent needs human input to continue
	NeedsHelpReason string // Why human help is needed
	Err             error
}

func New(s *store.Store, eb *eventbus.EventBus, llmCfg LLMConfig) *Orchestrator {
	return &Orchestrator{
		store:     s,
		eventBus:  eb,
		engines:   make(map[string]engine.Connector),
		llmConfig: llmCfg,
	}
}

// SetRegistry sets the ProviderRegistry for dynamic provider resolution.
func (o *Orchestrator) SetRegistry(reg *engine.ProviderRegistry) {
	o.registry = reg
}

// SetMCPManager sets the MCP Manager for tool resolution and execution.
func (o *Orchestrator) SetMCPManager(mgr *mcp.Manager) {
	o.mcpManager = mgr
}

// SetKnowledgeManager sets the Knowledge Manager for RAG retrieval and auto-embedding.
func (o *Orchestrator) SetKnowledgeManager(km *knowledge.Manager) {
	o.knowledgeManager = km
}

func (o *Orchestrator) RegisterEngine(conn engine.Connector) {
	o.engines[conn.Name()] = conn
}

func (o *Orchestrator) GetEngine(name string) (engine.Connector, bool) {
	e, ok := o.engines[name]
	return e, ok
}

// resolveConnector resolves the best Connector + model for an agent.
// Priority: ProviderRegistry (provider_id → engine_type → default) → legacy engines map.
func (o *Orchestrator) resolveConnector(ctx context.Context, agent *models.Agent) (engine.Connector, string, error) {
	// If we have a registry, use it — it handles provider_id, engine_type fallback, and default provider
	if o.registry != nil {
		conn, modelName, err := o.registry.ResolveForAgent(ctx, agent)
		if err == nil {
			if modelName == "" {
				modelName = resolveModel(agent.Model, o.llmConfig.Model)
			}
			return conn, modelName, nil
		}
		// If registry fails, fall through to legacy engines map
		log.Printf("orchestrator: registry resolve failed for %s: %v, trying legacy engines", agent.Name, err)
	}

	// Legacy fallback: direct engine map lookup by engine_type
	eng, ok := o.engines[agent.EngineType]
	if !ok {
		return nil, "", fmt.Errorf("no engine or provider available for agent %s (engine_type=%s)", agent.Name, agent.EngineType)
	}
	return eng, resolveModel(agent.Model, o.llmConfig.Model), nil
}

// StartExecution kicks off the planning → HitL → execution loop for a workforce.
func (o *Orchestrator) StartExecution(ctx context.Context, workforceID uuid.UUID, objective string, inputs map[string]string) (*models.Execution, error) {
	wf, err := o.store.GetWorkForce(ctx, workforceID)
	if err != nil {
		return nil, fmt.Errorf("get workforce: %w", err)
	}

	if wf.Status == models.WorkForceStatusExecuting {
		return nil, fmt.Errorf("workforce %s is already executing", workforceID)
	}

	exec, err := o.store.CreateExecution(ctx, workforceID, objective, inputs)
	if err != nil {
		return nil, fmt.Errorf("create execution: %w", err)
	}

	// Move to planning phase
	if err := o.store.UpdateExecutionStatus(ctx, exec.ID, models.ExecutionStatusPlanning); err != nil {
		return nil, fmt.Errorf("update exec status: %w", err)
	}
	exec.Status = models.ExecutionStatusPlanning

	if err := o.store.UpdateWorkForceStatus(ctx, workforceID, models.WorkForceStatusPlanning); err != nil {
		return nil, fmt.Errorf("update wf status: %w", err)
	}

	o.eventBus.PublishSystem(ctx, exec.ID, fmt.Sprintf("WorkForce '%s' starting planning phase for objective: %s", wf.Name, objective))

	// Record activity: execution started
	o.recordActivity(ctx, &models.ActivityEvent{
		WorkforceID:  &workforceID,
		ExecutionID:  &exec.ID,
		ActorType:    models.ActorTypeUser,
		ActorName:    "operator",
		Action:       "execution.started",
		ResourceType: "execution",
		ResourceID:   exec.ID.String(),
		Summary:      fmt.Sprintf("Execution started for '%s': %s", wf.Name, objective),
		Metadata:     map[string]any{"objective": objective, "workforce_name": wf.Name},
	})

	// Register a cancellable context NOW so HaltExecution can cancel planning too
	planCtx, planCancel := context.WithCancel(context.Background())
	o.activeExecs.Store(exec.ID, &executionContext{cancel: planCancel})

	// Run planning asynchronously
	go o.runPlanning(exec, wf, planCtx)

	return exec, nil
}

func (o *Orchestrator) runPlanning(exec *models.Execution, wf *models.WorkForce, ctx context.Context) {
	defer o.activeExecs.Delete(exec.ID)

	agents, err := o.loadWorkForceAgents(ctx, wf)
	if err != nil {
		log.Printf("orchestrator: load agents: %v", err)
		o.failExecution(ctx, exec.ID, wf.ID, err.Error())
		return
	}

	var strategy string
	var structuredPlan []models.ExecutionSubtask

	if len(agents) > 1 {
		// ── Multi-agent: run collaborative discussion phase ──
		leaderAgent := findLeaderAgent(agents, wf.LeaderAgentID)
		if leaderAgent == nil {
			o.failExecution(ctx, exec.ID, wf.ID, "no agents available")
			return
		}
		structuredPlan, strategy = o.runDiscussion(ctx, exec, wf, agents, leaderAgent)
	} else if len(agents) == 1 {
		// ── Single agent: skip discussion, build simple plan directly ──
		agent := agents[0]
		singleID := agent.ID
		o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &singleID, agent.Name, models.EventTypeAgentThinking,
			fmt.Sprintf("%s is analyzing the objective...", agent.Name), nil))
		structuredPlan = buildSimplePlan(agents, exec.Objective)
		strategy = fmt.Sprintf("## %s\nSole executor — working on objective directly.\n", agent.Name)
	} else {
		o.failExecution(ctx, exec.ID, wf.ID, "no agents in workforce")
		return
	}

	if err := o.store.UpdateExecutionStrategy(ctx, exec.ID, strategy); err != nil {
		log.Printf("orchestrator: update strategy: %v", err)
	}
	if len(structuredPlan) > 0 {
		if err := o.store.UpdateExecutionPlan(ctx, exec.ID, structuredPlan); err != nil {
			log.Printf("orchestrator: update plan: %v", err)
		}
		exec.Plan = structuredPlan
	}

	// Generate a short title for the execution in the background so it's ready
	// before the user sees the approval card. Fires a WS event when done.
	execIDCopy := exec.ID
	objectiveCopy := exec.Objective
	go o.generateAndSetTitle(execIDCopy, wf, agents, strategy, objectiveCopy)

	// If the execution was halted during planning, do not overwrite the halted status
	select {
	case <-ctx.Done():
		return
	default:
	}

	// Move to awaiting approval
	if err := o.store.UpdateExecutionStatus(ctx, exec.ID, models.ExecutionStatusAwaitingApproval); err != nil {
		log.Printf("orchestrator: update status: %v", err)
	}
	if err := o.store.UpdateWorkForceStatus(ctx, wf.ID, models.WorkForceStatusAwaitingApproval); err != nil {
		log.Printf("orchestrator: update wf status: %v", err)
	}

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypePlanProposed,
		"Strategy and execution plan proposed. Awaiting human approval.",
		map[string]any{"strategy": strategy, "plan": structuredPlan}))

	// Generate a concise summary of the combined strategy for the approval card
	// Prefer the workforce leader agent for this task
	approvalSummary := o.summarizeStrategy(ctx, wf, agents, strategy, exec.Objective)

	// Create a formal approval request for plan review
	wfID := wf.ID
	approvalReq := &models.CreateApprovalRequest{
		ExecutionID:  &exec.ID,
		ActionType:   models.ApprovalActionExecutionStart,
		Title:        fmt.Sprintf("Approve execution plan for '%s'", wf.Name),
		Description:  approvalSummary,
		Confidence:   0.0,
		RequestedBy:  "orchestrator",
	}
	if approval, err := o.store.CreateApproval(ctx, wfID, approvalReq); err != nil {
		log.Printf("orchestrator: create approval: %v", err)
	} else {
		o.recordActivity(ctx, &models.ActivityEvent{
			WorkforceID:  &wfID,
			ExecutionID:  &exec.ID,
			ActorType:    models.ActorTypeSystem,
			ActorName:    "orchestrator",
			Action:       "approval.created",
			ResourceType: "approval",
			ResourceID:   approval.ID.String(),
			Summary:      "Approval requested: " + approvalReq.Title,
			Metadata:     map[string]any{"action_type": "execution_start"},
		})
	}
}

// summarizeStrategy generates a short executive summary of the combined agent strategies.
// Uses the workforce leader agent if set; otherwise falls back to the first resolvable agent.
func (o *Orchestrator) summarizeStrategy(ctx context.Context, wf *models.WorkForce, agents []*models.Agent, strategy, objective string) string {
	if strategy == "" || len(agents) == 0 {
		return fmt.Sprintf("%d agent(s) have proposed their strategies. Review and approve to begin execution.", len(agents))
	}

	// Build candidate list: leader first, then the rest
	candidates := make([]*models.Agent, 0, len(agents))
	if wf.LeaderAgentID != nil {
		for _, a := range agents {
			if a.ID == *wf.LeaderAgentID {
				candidates = append(candidates, a)
				break
			}
		}
	}
	for _, a := range agents {
		if wf.LeaderAgentID == nil || a.ID != *wf.LeaderAgentID {
			candidates = append(candidates, a)
		}
	}

	// Pick the first resolvable engine from candidates
	var eng engine.Connector
	var modelName string
	for _, a := range candidates {
		e, m, err := o.resolveConnector(ctx, a)
		if err == nil {
			eng = e
			modelName = m
			break
		}
	}
	if eng == nil {
		return fmt.Sprintf("%d agent(s) have proposed their strategies. Review and approve to begin execution.", len(agents))
	}

	summarizePrompt := fmt.Sprintf(
		"You are summarizing an AI team's strategy for a human operator.\n\n"+
			"OBJECTIVE: %s\n\n"+
			"TEAM STRATEGIES:\n%s\n\n"+
			"Write a 2-3 sentence executive summary that:\n"+
			"1. States what the team collectively plans to do\n"+
			"2. Highlights the key actions or deliverables\n"+
			"3. Lists any critical information still needed from the operator (if any)\n\n"+
			"Be concise and direct. No headers, no bullet points. Plain sentences only.",
		objective, strategy,
	)

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentName:    "orchestrator",
		SystemPrompt: "You are a concise executive summarizer. Output plain prose only, 2-3 sentences maximum.",
		Message:      summarizePrompt,
		Model:        modelName,
	})
	if err != nil || strings.TrimSpace(resp.Content) == "" {
		return fmt.Sprintf("%d agent(s) have proposed their strategies for this mission. Review the Strategy Session above, then approve or reject.", len(agents))
	}

	summary := strings.TrimSpace(resp.Content)
	// Hard cap at 400 chars so it fits cleanly in the card
	runes := []rune(summary)
	if len(runes) > 400 {
		summary = string(runes[:397]) + "..."
	}
	return summary
}

// generateAndSetTitle makes a small LLM call to produce a 4-7 word human-readable
// title for the execution, persists it, and fires an execution_titled WS event.
// Runs as a goroutine — uses its own context with a 30s timeout.
func (o *Orchestrator) generateAndSetTitle(execID uuid.UUID, wf *models.WorkForce, agents []*models.Agent, strategy, objective string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Find the first resolvable engine (same logic as summarizeStrategy)
	var eng engine.Connector
	var modelName string
	candidates := make([]*models.Agent, 0, len(agents))
	if wf.LeaderAgentID != nil {
		for _, a := range agents {
			if a.ID == *wf.LeaderAgentID {
				candidates = append(candidates, a)
				break
			}
		}
	}
	for _, a := range agents {
		if wf.LeaderAgentID == nil || a.ID != *wf.LeaderAgentID {
			candidates = append(candidates, a)
		}
	}
	for _, a := range candidates {
		e, m, err := o.resolveConnector(ctx, a)
		if err == nil {
			eng = e
			modelName = m
			break
		}
	}
	if eng == nil {
		return
	}

	strategySample := strategy
	if len(strategySample) > 600 {
		strategySample = strategySample[:600]
	}

	prompt := fmt.Sprintf(
		"Generate a short, specific title (4-7 words) for this AI workforce execution.\n\n"+
			"OBJECTIVE: %s\n\n"+
			"STRATEGY OVERVIEW:\n%s\n\n"+
			"Rules:\n"+
			"- 4-7 words maximum\n"+
			"- Title Case\n"+
			"- No punctuation at the end\n"+
			"- Be specific to the actual task, not generic\n"+
			"- Good examples: 'Security Audit for GitHub Repo', 'Q2 Market Research Report', 'API Documentation Overhaul'\n\n"+
			"Output ONLY the title, nothing else.",
		objective, strategySample,
	)

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentName:    "orchestrator",
		SystemPrompt: "You output only a short title. No explanation, no quotes, no punctuation at the end.",
		Message:      prompt,
		Model:        modelName,
	})
	if err != nil || resp == nil || strings.TrimSpace(resp.Content) == "" {
		return
	}

	title := strings.TrimSpace(resp.Content)
	// Strip surrounding quotes if the model added them
	title = strings.Trim(title, `"'`)
	// Hard cap
	runes := []rune(title)
	if len(runes) > 80 {
		title = string(runes[:80])
	}

	titleStr := title
	if err := o.store.UpdateExecutionMeta(ctx, execID, models.UpdateExecutionMetaRequest{Title: &titleStr}); err != nil {
		log.Printf("orchestrator: set auto title: %v", err)
		return
	}

	o.eventBus.Publish(ctx, models.NewEvent(execID, nil, "", models.EventTypeExecutionTitled,
		fmt.Sprintf("Execution named: %s", title),
		map[string]any{"title": title}))
}

// ApproveExecution handles the HitL gate — approving or rejecting the plan.
func (o *Orchestrator) ApproveExecution(ctx context.Context, executionID uuid.UUID, approved bool, feedback string) error {
	exec, err := o.store.GetExecution(ctx, executionID)
	if err != nil {
		return err
	}

	if exec.Status != models.ExecutionStatusAwaitingApproval {
		return fmt.Errorf("execution %s is not awaiting approval (status: %s)", executionID, exec.Status)
	}

	if !approved {
		o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypePlanRejected,
			fmt.Sprintf("Plan rejected. Feedback: %s — replanning now.", feedback), nil))
		o.recordActivity(ctx, &models.ActivityEvent{
			WorkforceID:  &exec.WorkForceID,
			ExecutionID:  &exec.ID,
			ActorType:    models.ActorTypeUser,
			ActorName:    "operator",
			Action:       "execution.rejected",
			ResourceType: "execution",
			ResourceID:   exec.ID.String(),
			Summary:      "Execution plan rejected — triggering replan",
			Metadata:     map[string]any{"feedback": feedback},
		})

		// Resolve the pending approval as rejected
		if approvals, _, err := o.store.ListApprovals(ctx, exec.WorkForceID, "pending", 10, 0); err == nil {
			for _, a := range approvals {
				if a.ExecutionID != nil && *a.ExecutionID == exec.ID && a.ActionType == models.ApprovalActionExecutionStart {
					o.store.ResolveApproval(ctx, a.ID, false, feedback, "operator")
					break
				}
			}
		}

		// Store rejection feedback as a context message so replanning agents see it
		if feedback != "" {
			_ = o.store.CreateMessage(ctx, &models.Message{
				ID:          uuid.New(),
				ExecutionID: exec.ID,
				Role:        models.MessageRoleUser,
				Content: fmt.Sprintf("[Human Operator Rejected Plan — Revision Required]\n%s\n\n"+
					"Please revise your strategy and execution plan to fully address this feedback.", feedback),
				CreatedAt: time.Now(),
			})
		}

		// Reset to planning and trigger a fresh planning round
		if err := o.store.UpdateExecutionStatus(ctx, executionID, models.ExecutionStatusPlanning); err != nil {
			return err
		}
		wf, err := o.store.GetWorkForce(ctx, exec.WorkForceID)
		if err != nil {
			return o.store.UpdateExecutionStatus(ctx, executionID, models.ExecutionStatusFailed)
		}
		planCtx, planCancel := context.WithCancel(context.Background())
		o.activeExecs.Store(exec.ID, &executionContext{cancel: planCancel})
		go o.runPlanning(exec, wf, planCtx)
		return nil
	}

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypePlanApproved,
		"Plan approved! Starting execution loop.", nil))
	o.recordActivity(ctx, &models.ActivityEvent{
		WorkforceID:  &exec.WorkForceID,
		ExecutionID:  &exec.ID,
		ActorType:    models.ActorTypeUser,
		ActorName:    "operator",
		Action:       "execution.approved",
		ResourceType: "execution",
		ResourceID:   exec.ID.String(),
		Summary:      "Execution plan approved, starting execution loop",
	})

	// Resolve the pending approval for this execution
	if approvals, _, err := o.store.ListApprovals(ctx, exec.WorkForceID, "pending", 10, 0); err == nil {
		for _, a := range approvals {
			if a.ExecutionID != nil && *a.ExecutionID == exec.ID && a.ActionType == models.ApprovalActionExecutionStart {
				o.store.ResolveApproval(ctx, a.ID, true, feedback, "operator")
				break
			}
		}
	}

	// Start the execution loop
	go o.runExecutionLoop(exec, false)

	return nil
}

func (o *Orchestrator) runExecutionLoop(exec *models.Execution, resume bool) {
	ctx, cancel := context.WithCancel(context.Background())
	execCtx := &executionContext{cancel: cancel}
	o.activeExecs.Store(exec.ID, execCtx)
	defer o.activeExecs.Delete(exec.ID)

	// Intervention channel: human can inject messages mid-execution
	interventCh := make(chan string, 20)
	o.interventionChannels.Store(exec.ID, interventCh)
	defer o.interventionChannels.Delete(exec.ID)

	wf, err := o.store.GetWorkForce(ctx, exec.WorkForceID)
	if err != nil {
		log.Printf("orchestrator: get workforce: %v", err)
		o.failExecution(ctx, exec.ID, exec.WorkForceID, err.Error())
		return
	}

	agents, err := o.loadWorkForceAgents(ctx, wf)
	if err != nil {
		log.Printf("orchestrator: load agents: %v", err)
		o.failExecution(ctx, exec.ID, wf.ID, err.Error())
		return
	}

	if err := o.store.UpdateExecutionStatus(ctx, exec.ID, models.ExecutionStatusRunning); err != nil {
		log.Printf("orchestrator: update status: %v", err)
		return
	}
	if err := o.store.UpdateWorkForceStatus(ctx, wf.ID, models.WorkForceStatusExecuting); err != nil {
		log.Printf("orchestrator: update wf status: %v", err)
	}

	// Connect MCP servers for this workforce, injecting media provider credentials
	var mcpSession *mcp.Session
	if o.mcpManager != nil {
		imageEnv := o.resolveImageProviderEnv(ctx, agents)
		sess, mcpCleanup, mcpErr := o.mcpManager.ConnectWorkforceServers(ctx, wf.ID, imageEnv)
		if mcpErr != nil {
			log.Printf("orchestrator: MCP connect: %v", mcpErr)
		}
		if mcpCleanup != nil {
			defer mcpCleanup()
		}
		mcpSession = sess
	}

	// Safety budgets (no hard max_iterations — budget is the only ceiling)
	if wf.BudgetTokens <= 0 {
		wf.BudgetTokens = 2_000_000
	}
	if wf.BudgetTimeS <= 0 {
		wf.BudgetTimeS = 7200 // 2 hours default
	}
	deadline := time.Now().Add(time.Duration(wf.BudgetTimeS) * time.Second)
	const maxSteps = 500 // Absolute safety cap

	// Load or build the execution plan
	plan := exec.Plan
	if len(plan) == 0 {
		plan = buildSimplePlan(agents, exec.Objective)
		if err := o.store.UpdateExecutionPlan(ctx, exec.ID, plan); err != nil {
			log.Printf("orchestrator: store simple plan: %v", err)
		}
	}

	if resume {
		// Resume: preserve completed subtasks, reset interrupted ones back to pending
		for i := range plan {
			if plan[i].Status != models.SubtaskDone {
				plan[i].Status = models.SubtaskPending
			}
		}
		// Inject a resume context message so agents know where they left off
		resumeMsg := &models.Message{
			ID: uuid.New(), ExecutionID: exec.ID,
			Iteration: 0, Role: models.MessageRoleUser,
			AgentName: "system",
			Content:   "[RESUME] Execution resumed by operator. Review the conversation history above to understand what has already been done and continue from where the team left off.",
			CreatedAt: time.Now(),
		}
		o.store.CreateMessage(ctx, resumeMsg)
	} else {
		// Fresh start: reset all subtasks
		for i := range plan {
			plan[i].Status = models.SubtaskPending
			plan[i].Output = ""
		}
	}
	o.store.UpdateExecutionPlan(ctx, exec.ID, plan)

	doneCount := 0
	for _, st := range plan {
		if st.Status == models.SubtaskDone {
			doneCount++
		}
	}
	pendingCount := len(plan) - doneCount

	eventMsg := fmt.Sprintf("Pipeline execution started — %d subtasks queued.", len(plan))
	if resume {
		eventMsg = fmt.Sprintf("Execution resumed — %d subtasks remaining (%d already completed).", pendingCount, doneCount)
	}
	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypeExecutionStarted,
		eventMsg,
		map[string]any{"plan": plan, "resume": resume}))

	stepCount := 0
	var pendingIntervention string

	for !allSubtasksDone(plan) {
		// ── Cancellation ──
		select {
		case <-ctx.Done():
			o.haltExecution(context.Background(), exec.ID, wf.ID, "Manual halt requested")
			return
		default:
		}

		// ── Budget checks ──
		if time.Now().After(deadline) {
			o.haltExecution(ctx, exec.ID, wf.ID, "Time budget exhausted")
			return
		}
		if execCtx.tokensUsed.Load() >= wf.BudgetTokens {
			o.haltExecution(ctx, exec.ID, wf.ID, "Token budget exhausted")
			return
		}
		if stepCount >= maxSteps {
			o.completeExecution(ctx, exec.ID, wf.ID, "Step limit reached — collecting outputs",
				execCtx.tokensUsed.Load(), stepCount)
			return
		}

		// ── Drain intervention channel ──
		select {
		case msg := <-interventCh:
			// Persist the human message so it appears in the chat
			humanMsg := &models.Message{
				ID: uuid.New(), ExecutionID: exec.ID,
				Iteration: stepCount + 1, Role: models.MessageRoleUser,
				AgentName: "You", Content: msg, CreatedAt: time.Now(),
			}
			o.store.CreateMessage(ctx, humanMsg)

			// Auto-halt if the operator explicitly wants to stop
			msgLower := strings.ToLower(strings.TrimSpace(msg))
			if msgLower == "stop" || msgLower == "halt" || msgLower == "pause" ||
				strings.HasPrefix(msgLower, "stop ") || strings.HasPrefix(msgLower, "halt ") ||
				strings.Contains(msgLower, "please stop") || strings.Contains(msgLower, "stop now") ||
				strings.Contains(msgLower, "halt now") || strings.Contains(msgLower, "please halt") {
				o.haltExecution(ctx, exec.ID, wf.ID, "Halted by operator: "+msg)
				return
			}

			pendingIntervention = msg
			// Unblock any waiting subtasks
			for i := range plan {
				if plan[i].Status == models.SubtaskNeedsHelp || plan[i].Status == models.SubtaskBlocked {
					plan[i].Status = models.SubtaskPending
				}
			}
			o.store.UpdateExecutionPlan(ctx, exec.ID, plan)
			o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypeHumanIntervened,
				"Human intervened: "+msg,
				map[string]any{"message": msg}))
		default:
		}

		// ── Pause if waiting for human ──
		if hasNeedsHelp(plan) {
			time.Sleep(3 * time.Second)
			continue
		}

		// ── Find ready subtasks (deps met, status=pending) ──
		ready := findReadySubtasks(plan)
		if len(ready) == 0 {
			// Deadlock: nothing runnable and not all done
			if !allSubtasksDone(plan) {
				o.haltExecution(ctx, exec.ID, wf.ID, buildDeadlockMessage(plan))
			}
			return
		}

		// ── Execute each ready subtask (sequential for full observability) ──
		for _, subtaskIdx := range ready {
			subtask := &plan[subtaskIdx]
			subtask.Status = models.SubtaskRunning
			o.store.UpdateExecutionPlan(ctx, exec.ID, plan)

			agent := findAgentByID(agents, subtask.AgentID)
			if agent == nil {
				subtask.Status = models.SubtaskBlocked
				subtask.ErrorMsg = fmt.Sprintf("agent %s not found in this workforce", subtask.AgentID)
				o.store.UpdateExecutionPlan(ctx, exec.ID, plan)
				o.eventBus.PublishSystem(ctx, exec.ID,
					fmt.Sprintf("Agent %s not found for subtask %s — blocked", subtask.AgentID, subtask.ID))
				continue
			}

			o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &subtask.AgentID, subtask.AgentName,
				models.EventTypeSubtaskStarted,
				fmt.Sprintf("[%s/%s] Starting: %s", subtask.ID, subtask.AgentName, truncateStr(subtask.Subtask, 100)),
				map[string]any{"subtask_id": subtask.ID, "subtask": subtask.Subtask, "depends_on": subtask.DependsOn}))

			handoffCtx := buildHandoffContext(plan, subtask.DependsOn)
			convCtx := o.buildConversationContext(ctx, exec.ID, wf.ID, exec.Objective)

			res := o.runAgentTask(ctx, runAgentParams{
				exec:            exec,
				wf:              wf,
				agent:           agent,
				allAgents:       agents,
				iteration:       stepCount + 1,
				subtask:         subtask,
				handoffCtx:      handoffCtx,
				interventionMsg: pendingIntervention,
				convCtx:         convCtx,
				mcpSession:      mcpSession,
				execCtx:         execCtx,
			})

			// Consume the intervention message — it's been injected into this task
			pendingIntervention = ""

			if res.Err != nil {
				subtask.Status = models.SubtaskBlocked
				subtask.ErrorMsg = res.Err.Error()
			} else if res.NeedsHelp {
				subtask.Status = models.SubtaskNeedsHelp
				o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &subtask.AgentID, subtask.AgentName,
					models.EventTypeHumanRequired,
					fmt.Sprintf("[%s/%s] Needs human input: %s", subtask.ID, subtask.AgentName, res.NeedsHelpReason),
					map[string]any{"reason": res.NeedsHelpReason, "subtask_id": subtask.ID}))
			} else {
				subtask.Status = models.SubtaskDone
				// Prefer summary from completion signal when available
				if res.Summary != "" {
					subtask.Output = res.Summary + "\n\n" + res.Content
				} else {
					subtask.Output = res.Content
				}

				o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &subtask.AgentID, subtask.AgentName,
					models.EventTypeSubtaskDone,
					fmt.Sprintf("[%s/%s] Subtask complete", subtask.ID, subtask.AgentName),
					map[string]any{"subtask_id": subtask.ID, "tokens": res.Tokens}))

				// Emit handoff events for agents waiting on this subtask
				for i, st := range plan {
					if containsStr(st.DependsOn, subtask.ID) && plan[i].Status == models.SubtaskPending {
						depCopy := plan[i]
						o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &depCopy.AgentID, depCopy.AgentName,
							models.EventTypeAgentHandoff,
							fmt.Sprintf("[Handoff] %s → %s: context ready", subtask.AgentName, depCopy.AgentName),
							map[string]any{"from_agent": subtask.AgentName, "to_agent": depCopy.AgentName,
								"from_subtask": subtask.ID, "to_subtask": depCopy.ID}))
					}
				}
			}

			o.store.UpdateExecutionPlan(ctx, exec.ID, plan)
			stepCount++
			execCtx.iterations.Add(1)

			o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypeIterationDone,
				fmt.Sprintf("Step %d complete. Tokens: %d", stepCount, execCtx.tokensUsed.Load()),
				map[string]any{"step": stepCount, "tokens_used": execCtx.tokensUsed.Load()}))
		}
	}

	// All subtasks done — collect outputs
	var outputs []string
	for _, st := range plan {
		if st.Output != "" {
			outputs = append(outputs, fmt.Sprintf("[%s - %s]:\n%s", st.ID, st.AgentName, st.Output))
		}
	}

	// P3: Post-execution quality review by leader (multi-agent only, advisory)
	leaderAgent := findLeaderAgent(agents, wf.LeaderAgentID)
	if leaderAgent != nil && len(agents) > 1 {
		o.runReview(ctx, exec, wf, agents, leaderAgent, plan)
	}

	o.completeExecution(ctx, exec.ID, wf.ID, joinResults(outputs), execCtx.tokensUsed.Load(), stepCount)
}

// runAgentParams holds everything needed to run a single agent subtask.
type runAgentParams struct {
	exec            *models.Execution
	wf              *models.WorkForce
	agent           *models.Agent
	allAgents       []*models.Agent          // all agents in the workforce — needed for ask_peer (P2)
	iteration       int
	subtask         *models.ExecutionSubtask // current pipeline step
	handoffCtx      string                   // outputs from completed depends_on subtasks
	interventionMsg string                   // human message injected mid-flight
	convCtx         string                   // recent message window
	mcpSession      *mcp.Session
	execCtx         *executionContext
}

// runAgentTask executes a single agent subtask in the pipeline.
func (o *Orchestrator) runAgentTask(ctx context.Context, p runAgentParams) agentResult {
	agent := p.agent
	agentID := agent.ID

	eng, modelName, resolveErr := o.resolveConnector(ctx, agent)
	if resolveErr != nil {
		o.eventBus.PublishSystem(ctx, p.exec.ID, fmt.Sprintf("No engine for agent '%s': %v, skipping", agent.Name, resolveErr))
		return agentResult{AgentID: agentID, AgentName: agent.Name, Err: resolveErr}
	}

	o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentThinking,
		fmt.Sprintf("%s is working on subtask...", agent.Name), nil))

	systemPrompt, _ := engine.InterpolatePrompt(agent.SystemPrompt, agent.Variables, p.exec.Inputs)
	instructions, _ := engine.InterpolatePrompt(agent.Instructions, agent.Variables, p.exec.Inputs)

	// ── Per-agent episodic memory from Qdrant ──
	// Retrieve what this specific agent has done in past executions (long-term memory)
	agentMemoryCtx := ""
	if o.knowledgeManager != nil {
		subtaskQuery := p.exec.Objective
		if p.subtask != nil {
			subtaskQuery = p.subtask.Subtask
		}
		mem, err := o.knowledgeManager.RetrieveRelevantForAgent(ctx, agentID, subtaskQuery, 3)
		if err != nil {
			log.Printf("orchestrator: agent memory retrieval (%s): %v", agent.Name, err)
		} else if mem != "" {
			agentMemoryCtx = mem
		}
	}

	// ── Determine the specific task for this subtask ──
	subtaskDesc := p.exec.Objective
	if p.subtask != nil && p.subtask.Subtask != "" {
		subtaskDesc = p.subtask.Subtask
	}

	// ── Build task message ──
	var taskParts []string
	taskParts = append(taskParts, fmt.Sprintf("## Overall Objective\n%s", p.exec.Objective))
	taskParts = append(taskParts, fmt.Sprintf("## Your Assigned Subtask (step %d)\n%s", p.iteration, subtaskDesc))

	if p.handoffCtx != "" {
		taskParts = append(taskParts, fmt.Sprintf("## Context from Previous Agents\n%s", p.handoffCtx))
	}
	if agentMemoryCtx != "" {
		taskParts = append(taskParts, fmt.Sprintf("## Your Long-Term Memory (relevant past work)\n%s", agentMemoryCtx))
	}
	if p.convCtx != "" && p.convCtx != "(no previous conversation)" {
		taskParts = append(taskParts, fmt.Sprintf("## Recent Conversation History\n%s", p.convCtx))
	}
	if p.interventionMsg != "" {
		taskParts = append(taskParts, fmt.Sprintf("## Human Operator Instruction\n%s", p.interventionMsg))
	}

	// Build the peer agent list for ask_peer instructions
	peerList := ""
	if len(p.allAgents) > 1 {
		var peerNames []string
		for _, a := range p.allAgents {
			if a.ID != agent.ID {
				peerNames = append(peerNames, a.Name)
			}
		}
		if len(peerNames) > 0 {
			peerList = "\n\nIf you need a quick answer from a teammate before continuing, you may consult them once:\n" +
				"```json\n{\"status\": \"ask_peer\", \"peer\": \"<exact agent name>\", \"question\": \"<concise question>\"}\n```\n" +
				"Available peers: " + strings.Join(peerNames, ", ") + "\nUse this sparingly — only for critical blockers."
		}
	}

	// ── Workspace + credentials context ──────────────────────────────────────
	workspacePath := workspace.WorkspacePath(p.wf.Name)
	taskParts = append(taskParts, fmt.Sprintf(
		"## Your Workspace\n"+
			"Path: `%s`\n\n"+
			"This is your dedicated workspace — treat it exactly like a local development machine:\n"+
			"- Full read/write access. Create, edit, delete files freely.\n"+
			"- Use `run_command` to run git, npm, python, cargo, curl, bash scripts — anything.\n"+
			"- Clone repos here, run builds, write output files. Files persist for this workforce.\n"+
			"- AitherOS platform source is readable (not writable) at `/opt/AitherOS`.\n\n"+
			"**Credentials** — your team's stored secrets are available via Aither-Tools:\n"+
			"- `list_secrets()` — discover all available service/key pairs before making authenticated requests\n"+
			"- `get_secret(\"service\", \"key_name\")` — retrieve a specific credential value\n"+
			"- If a credential you need is not listed, signal `needs_help` with the exact service and key name.",
		workspacePath))

	taskParts = append(taskParts, fmt.Sprintf("---\n"+
		"Execute your subtask now. Produce your output directly.\n\n"+
		"## Tool Usage — MANDATORY\n"+
		"You have MCP tools available. Use them aggressively and persistently:\n"+
		"- **Shell**: `run_command` — git, npm, python, curl, bash. Clone repos to `%s`, run tests, compile, deploy.\n"+
		"- **Filesystem**: read/write files in your workspace or read `/opt/AitherOS` (AitherOS source, read-only).\n"+
		"- **Secrets**: call `list_secrets()` before any authenticated request to see what credentials exist.\n"+
		"- **GitHub rate-limit errors**: automatically retried after 62s — do NOT signal `needs_help` for these.\n"+
		"- You can make as many tool calls as needed — there is NO limit. Keep going until the subtask is done.\n"+
		"- If a tool fails or returns partial results, try a different approach or parameters.\n"+
		"- **Never give up because a single tool call returned insufficient information.**\n\n"+
		"## Completion Signals\n"+
		"When your subtask is FULLY complete, end your response with:\n"+
		"```json\n{\"status\": \"complete\", \"summary\": \"<one-sentence summary of what you did>\"}\n```\n"+
		"Other agents may have additional subtasks — your signal only marks YOUR subtask done.\n\n"+
		"Signal `needs_help` ONLY as a last resort — exhausted all tools AND need something only a human can provide:\n"+
		"```json\n{\"status\": \"needs_help\", \"reason\": \"<exactly what you tried and what you still need>\"}\n```\n\n"+
		"If blocked by a hard dependency no tool can resolve:\n"+
		"```json\n{\"status\": \"blocked\", \"reason\": \"<what is blocking you>\"}\n```"+
		peerList, workspacePath))

	taskMsg := strings.Join(taskParts, "\n\n")

	// Log the prompt as a message (role=user)
	promptMsg := &models.Message{
		ID:          uuid.New(),
		ExecutionID: p.exec.ID,
		AgentID:     &agentID,
		AgentName:   agent.Name,
		Iteration:   p.iteration,
		Role:        models.MessageRoleUser,
		Content:     taskMsg,
		Model:       modelName,
		CreatedAt:   time.Now(),
	}
	if err := o.store.CreateMessage(ctx, promptMsg); err != nil {
		log.Printf("orchestrator: log prompt message: %v", err)
	}

	// Resolve MCP tool definitions for this agent
	var toolDefs []engine.ToolDefinition
	if o.mcpManager != nil {
		toolDefs = o.mcpManager.ResolveAgentToolDefs(ctx, p.wf.ID, agent.ID)
	}
	// Append virtual signal tools so LLMs that prefer function-calling over
	// inline JSON can still trigger the completion/halt/peer flows correctly.
	toolDefs = append(toolDefs, virtualSignalTools...)

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentID:      agent.ID,
		AgentName:    agent.Name,
		SystemPrompt: systemPrompt,
		Instructions: instructions,
		Message:      taskMsg,
		Model:        modelName,
		Tools:        agent.Tools,
		ToolDefs:     toolDefs,
	})
	if err != nil {
		cleanErr := cleanAPIError(err.Error())
		o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentError,
			fmt.Sprintf("%s encountered an error: %s", agent.Name, cleanErr), nil))
		// Rate/quota errors are recoverable — surface as needs_help so the user can act
		// (add credits, switch provider, wait for reset) rather than deadlocking the execution.
		if isRateLimitError(err) {
			return agentResult{
				AgentID:         agentID,
				AgentName:       agent.Name,
				NeedsHelp:       true,
				NeedsHelpReason: "LLM provider rate limit: " + cleanErr,
			}
		}
		return agentResult{AgentID: agentID, AgentName: agent.Name, Err: err}
	}

	// ── Tool call feedback loop ──
	const maxToolRounds = 40
	var allToolCalls []engine.ToolCallInfo
	var totalTokensIn, totalTokensOut, totalLatency int64

	sysContent := systemPrompt
	if instructions != "" {
		sysContent += "\n\n## Instructions\n" + instructions
	}
	history := []engine.ChatMessage{
		{Role: "system", Content: sysContent},
		{Role: "user", Content: taskMsg},
	}

	for toolRound := 0; toolRound < maxToolRounds && len(resp.ToolCalls) > 0 && p.mcpSession != nil; toolRound++ {
		signalled := false
		for i, tc := range resp.ToolCalls {
			// Intercept virtual signal tools before dispatching to MCP.
			if handleVirtualSignalTool(tc, resp) {
				o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeToolCall,
					fmt.Sprintf("%s signalled via %s", agent.Name, tc.Name),
					map[string]any{"tool": tc.Name, "args": tc.Args}))
				signalled = true
				break
			}

			o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeToolCall,
				fmt.Sprintf("%s is calling tool: %s (round %d)", agent.Name, tc.Name, toolRound+1),
				map[string]any{"tool": tc.Name, "args": tc.Args, "round": toolRound + 1}))

			result, toolErr := p.mcpSession.ExecuteToolCall(ctx, p.wf.ID, tc.Name, tc.Args)
			// Retry once on rate-limit errors (GitHub secondary rate limit needs ~60s)
			if toolErr != nil && isRateLimitError(toolErr) {
				o.eventBus.PublishSystem(ctx, p.exec.ID,
					fmt.Sprintf("%s: rate limit hit on %s — waiting 62s before retry", agent.Name, tc.Name))
				select {
				case <-time.After(62 * time.Second):
				case <-ctx.Done():
					resp.ToolCalls[i].Result = "Error: execution cancelled during rate-limit wait"
					continue
				}
				result, toolErr = p.mcpSession.ExecuteToolCall(ctx, p.wf.ID, tc.Name, tc.Args)
			}
			if toolErr != nil {
				resp.ToolCalls[i].Result = fmt.Sprintf("Error: %s", toolErr.Error())
				o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentError,
					fmt.Sprintf("Tool %s error: %s", tc.Name, toolErr.Error()), nil))
			} else {
				resp.ToolCalls[i].Result = result
				o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeToolCall,
					fmt.Sprintf("%s received result from %s (round %d)", agent.Name, tc.Name, toolRound+1),
					map[string]any{"tool": tc.Name, "result_length": len(result), "round": toolRound + 1}))
			}
		}

		if signalled {
			break
		}

		allToolCalls = append(allToolCalls, resp.ToolCalls...)
		totalTokensIn += resp.TokensIn
		totalTokensOut += resp.TokensOut
		totalLatency += resp.LatencyMs

		history = append(history, engine.ChatMessage{
			Role:      "assistant",
			Content:   resp.Content,
			ToolCalls: resp.ToolCalls,
		})
		for _, tc := range resp.ToolCalls {
			history = append(history, engine.ChatMessage{
				Role:       "tool",
				Content:    tc.Result,
				ToolCallID: tc.ID,
			})
		}

		resp, err = eng.Submit(ctx, engine.TaskRequest{
			AgentID:   agent.ID,
			AgentName: agent.Name,
			Model:     modelName,
			Tools:     agent.Tools,
			ToolDefs:  toolDefs,
			History:   history,
		})
		if err != nil {
			o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentError,
				fmt.Sprintf("%s tool loop error (round %d): %s", agent.Name, toolRound+1, err.Error()), nil))
			break
		}
	}

	// Guard: if the tool loop broke due to a Submit error, resp is nil — bail out.
	if resp == nil {
		return agentResult{AgentID: agentID, AgentName: agent.Name, Err: fmt.Errorf("nil LLM response after tool loop error")}
	}

	// Warn when tool round limit was reached without a completion signal
	if len(resp.ToolCalls) > 0 {
		o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentError,
			fmt.Sprintf("%s reached the %d-round tool call limit without completing — will attempt to extract result from last response", agent.Name, maxToolRounds),
			nil))
	}

	// ── Peer consultation loop (P2) ──
	// An agent may pause and ask a peer a question before completing its subtask.
	const maxPeerConsults = 3
	for peerRound := 0; peerRound < maxPeerConsults; peerRound++ {
		sig := extractCompletionSignal(resp.Content)
		if sig == nil || sig.Status != "ask_peer" || sig.PeerAgent == "" || sig.Question == "" {
			break
		}
		// Consume tokens for the response that contained the ask_peer signal
		totalTokensIn += resp.TokensIn
		totalTokensOut += resp.TokensOut
		totalLatency += resp.LatencyMs

		peerAnswer := o.runPeerConsultation(ctx, p.exec, agent, p.allAgents, sig.PeerAgent, sig.Question)

		// Build updated history: current response + peer answer injected as user message
		history = append(history,
			engine.ChatMessage{Role: "assistant", Content: resp.Content},
			engine.ChatMessage{
				Role:    "user",
				Content: fmt.Sprintf("[Peer consultation — %s answered]: %s\n\nContinue with your subtask now.", sig.PeerAgent, peerAnswer),
			},
		)

		resp, err = eng.Submit(ctx, engine.TaskRequest{
			AgentID:   agent.ID,
			AgentName: agent.Name,
			Model:     modelName,
			Tools:     agent.Tools,
			ToolDefs:  toolDefs,
			History:   history,
		})
		if err != nil {
			o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentError,
				fmt.Sprintf("%s peer consultation re-submit error: %s", agent.Name, err.Error()), nil))
			break
		}
	}

	// Guard: if the peer loop broke due to a Submit error, resp could be nil.
	if resp == nil {
		log.Printf("orchestrator: %s peer loop produced nil response, returning error", agent.Name)
		return agentResult{AgentID: agentID, AgentName: agent.Name, Err: fmt.Errorf("nil LLM response after peer loop")}
	}

	// Accumulate final response tokens
	allToolCalls = append(allToolCalls, resp.ToolCalls...)
	totalTokensIn += resp.TokensIn
	totalTokensOut += resp.TokensOut
	totalLatency += resp.LatencyMs

	// Log the final response
	var toolCallsJSON []models.ToolCallJSON
	for _, tc := range allToolCalls {
		toolCallsJSON = append(toolCallsJSON, models.ToolCallJSON{
			Name: tc.Name, Args: tc.Args, Result: tc.Result,
		})
	}
	responseMsg := &models.Message{
		ID:          uuid.New(),
		ExecutionID: p.exec.ID,
		AgentID:     &agentID,
		AgentName:   agent.Name,
		Iteration:   p.iteration,
		Role:        models.MessageRoleAssistant,
		Content:     resp.Content,
		TokensIn:    totalTokensIn,
		TokensOut:   totalTokensOut,
		Model:       resp.Model,
		LatencyMs:   totalLatency,
		ToolCalls:   toolCallsJSON,
		CreatedAt:   time.Now(),
	}
	if err := o.store.CreateMessage(ctx, responseMsg); err != nil {
		log.Printf("orchestrator: log response message: %v", err)
	}

	// Track tokens (thread-safe via atomic)
	tokensForCall := totalTokensIn + totalTokensOut
	if tokensForCall == 0 {
		tokensForCall = resp.TokensUsed
	}
	p.execCtx.tokensUsed.Add(tokensForCall)
	o.store.IncrementExecutionTokens(ctx, p.exec.ID, tokensForCall)

	o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentCompleted,
		fmt.Sprintf("%s completed their subtask.", agent.Name),
		map[string]any{
			"content":       resp.Content,
			"tokens_total":  tokensForCall,
			"tokens_input":  totalTokensIn,
			"tokens_output": totalTokensOut,
			"model":         resp.Model,
			"latency_ms":    totalLatency,
		}))

	// ── Immediate episodic embedding (per-agent Qdrant memory) ──
	// Embed this agent's response right away so other agents in the same
	// execution can benefit from it, and so it persists for future executions.
	if o.knowledgeManager != nil {
		o.knowledgeManager.IngestSingleMessage(ctx, p.wf.ID, p.exec.ID, &agentID,
			agent.Name, p.iteration, resp.Content, resp.Model)
	}

	// ── Parse completion signal ──
	signal := extractCompletionSignal(resp.Content)
	complete := isObjectiveComplete(resp.Content)
	needsHelp := signal != nil && (signal.Status == "needs_help")
	blocked := signal != nil && signal.Status == "blocked"
	reason := ""
	if signal != nil {
		reason = signal.Reason
	}
	summary := ""
	if complete {
		summary = extractCompletionSummary(resp.Content)
	}

	return agentResult{
		AgentID:         agentID,
		AgentName:       agent.Name,
		Content:         resp.Content,
		Tokens:          tokensForCall,
		Complete:        complete,
		Summary:         summary,
		NeedsHelp:       needsHelp || blocked,
		NeedsHelpReason: reason,
	}
}

// buildConversationContext retrieves recent messages to give agents memory across iterations,
// plus RAG-retrieved knowledge from previous executions in the same workforce.
func (o *Orchestrator) buildConversationContext(ctx context.Context, execID, workforceID uuid.UUID, objective string) string {
	var sections []string

	// ── RAG: Retrieve relevant knowledge from workforce knowledge base ──
	if o.knowledgeManager != nil && objective != "" {
		ragCtx, err := o.knowledgeManager.RetrieveRelevant(ctx, workforceID, objective, 3)
		if err != nil {
			log.Printf("orchestrator: RAG retrieval: %v", err)
		} else if ragCtx != "" {
			sections = append(sections, fmt.Sprintf("## Relevant Knowledge (from previous executions)\n%s", ragCtx))
		}
	}

	// ── Sliding window of recent messages in this execution ──
	msgs, err := o.store.GetRecentMessages(ctx, execID, maxConversationMemory)
	if err != nil || len(msgs) == 0 {
		if len(sections) == 0 {
			return "(no previous conversation)"
		}
		return strings.Join(sections, "\n\n---\n\n")
	}

	var parts []string
	for _, m := range msgs {
		prefix := fmt.Sprintf("[%s/%s iter=%d]", m.AgentName, m.Role, m.Iteration)
		// Truncate very long messages to avoid blowing up context
		content := m.Content
		if len(content) > 2000 {
			content = content[:2000] + "... (truncated)"
		}
		parts = append(parts, fmt.Sprintf("%s %s", prefix, content))
	}
	sections = append(sections, strings.Join(parts, "\n\n"))
	return strings.Join(sections, "\n\n---\n\n")
}

// StartScheduler runs the autonomous workforce scheduler until ctx is cancelled.
// Every minute it checks workforces with autonomous_mode=true and fires an execution
// if heartbeat_interval_m has elapsed since the last execution.
func (o *Orchestrator) StartScheduler(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	log.Println("orchestrator: autonomous scheduler started")
	for {
		select {
		case <-ctx.Done():
			log.Println("orchestrator: autonomous scheduler stopped")
			return
		case <-ticker.C:
			o.runSchedulerTick(ctx)
		}
	}
}

func (o *Orchestrator) runSchedulerTick(ctx context.Context) {
	workforces, err := o.store.ListAutonomousWorkforces(ctx)
	if err != nil {
		log.Printf("scheduler: list autonomous workforces: %v", err)
		return
	}
	for _, wf := range workforces {
		// Skip if already running
		if wf.Status == models.WorkForceStatusExecuting || wf.Status == models.WorkForceStatusPlanning {
			continue
		}
		// Skip if an active execution goroutine is registered
		var alreadyActive bool
		o.activeExecs.Range(func(_, v any) bool {
			alreadyActive = true
			return false
		})
		if alreadyActive {
			continue
		}

		// Check if enough time has elapsed since the last execution
		lastExec, err := o.store.GetLatestExecution(ctx, wf.ID)
		if err != nil {
			log.Printf("scheduler: latest execution for %q: %v", wf.Name, err)
			continue
		}
		if lastExec != nil {
			interval := time.Duration(wf.HeartbeatIntervalM) * time.Minute
			if time.Since(lastExec.CreatedAt) < interval {
				continue // too soon
			}
		}

		log.Printf("scheduler: auto-launching execution for workforce %q (interval=%dm)", wf.Name, wf.HeartbeatIntervalM)
		if _, err := o.StartExecution(ctx, wf.ID, wf.Objective, nil); err != nil {
			log.Printf("scheduler: start execution for %q: %v", wf.Name, err)
		}
	}
}

// isObjectiveComplete checks if the agent's response contains a structured completion signal.
// Only the code-fenced JSON block is authoritative — legacy string matching is too fragile.
func isObjectiveComplete(content string) bool {
	signal := extractCompletionSignal(content)
	return signal != nil && signal.Status == "complete"
}

// extractCompletionSignal tries to find a {"status": "complete"} JSON block in the content.
func extractCompletionSignal(content string) *completionSignal {
	// Try to find JSON block in markdown code fence
	for _, start := range []string{"```json\n", "```\n"} {
		idx := strings.Index(content, start)
		if idx == -1 {
			continue
		}
		jsonStart := idx + len(start)
		endIdx := strings.Index(content[jsonStart:], "```")
		if endIdx == -1 {
			continue
		}
		var sig completionSignal
		if err := json.Unmarshal([]byte(strings.TrimSpace(content[jsonStart:jsonStart+endIdx])), &sig); err == nil {
			if sig.Status != "" {
				return &sig
			}
		}
	}

	return nil
}

// extractCompletionSummary returns the summary from a completion signal, if present.
func extractCompletionSummary(content string) string {
	sig := extractCompletionSignal(content)
	if sig != nil {
		return sig.Summary
	}
	return ""
}

// ResumeExecution resumes a halted execution from where it left off.
// Completed subtasks are preserved; interrupted ones are reset to pending.
func (o *Orchestrator) ResumeExecution(ctx context.Context, executionID uuid.UUID) error {
	exec, err := o.store.GetExecution(ctx, executionID)
	if err != nil {
		return fmt.Errorf("execution not found: %w", err)
	}

	if exec.Status != models.ExecutionStatusHalted {
		return fmt.Errorf("execution %s is not halted (status: %s)", executionID, exec.Status)
	}

	o.recordActivity(ctx, &models.ActivityEvent{
		WorkforceID:  &exec.WorkForceID,
		ExecutionID:  &exec.ID,
		ActorType:    models.ActorTypeUser,
		ActorName:    "operator",
		Action:       "execution.resumed",
		ResourceType: "execution",
		ResourceID:   exec.ID.String(),
		Summary:      "Execution resumed by operator",
	})

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypeExecutionStarted,
		"Execution resumed by operator. Continuing from previous state.",
		map[string]any{"execution_id": executionID}))

	go o.runExecutionLoop(exec, true)

	return nil
}

// HaltExecution manually stops a running execution.
// It always updates the DB status to halted, regardless of whether
// the in-memory goroutine is still alive (handles PM2 restarts etc.).
func (o *Orchestrator) HaltExecution(executionID uuid.UUID) error {
	ctx := context.Background()

	// Verify the execution exists
	exec, err := o.store.GetExecution(ctx, executionID)
	if err != nil {
		return fmt.Errorf("execution not found: %w", err)
	}

	// Cancel the goroutine context if it is still running
	if val, ok := o.activeExecs.Load(executionID); ok {
		if ec, ok := val.(*executionContext); ok {
			ec.cancel()
		}
		o.activeExecs.Delete(executionID)
	}
	// Remove intervention channel if present
	o.interventionChannels.Delete(executionID)

	// Always update DB status to halted
	if err := o.store.UpdateExecutionStatus(ctx, executionID, models.ExecutionStatusHalted); err != nil {
		return fmt.Errorf("update execution status: %w", err)
	}
	o.store.UpdateWorkForceStatus(ctx, exec.WorkForceID, models.WorkForceStatusHalted)

	o.eventBus.Publish(ctx, models.NewEvent(executionID, nil, "", models.EventTypeExecutionHalted,
		"Execution halted by user", map[string]any{"execution_id": executionID}))

	return nil
}

func (o *Orchestrator) loadWorkForceAgents(ctx context.Context, wf *models.WorkForce) ([]*models.Agent, error) {
	return o.store.GetAgentsBatch(ctx, wf.AgentIDs)
}

func (o *Orchestrator) failExecution(ctx context.Context, execID, wfID uuid.UUID, errMsg string) {
	o.store.UpdateExecutionStatus(ctx, execID, models.ExecutionStatusFailed)
	o.store.UpdateWorkForceStatus(ctx, wfID, models.WorkForceStatusFailed)
	// If this execution was linked to a kanban task, mark it blocked
	if task, _ := o.store.FindKanbanTaskByExecutionID(ctx, execID); task != nil {
		blocked := models.KanbanStatusBlocked
		o.store.UpdateKanbanTask(ctx, task.ID, models.UpdateKanbanTaskRequest{Status: &blocked})
	}
	var wfName, execTitle string
	if wf, err := o.store.GetWorkForce(ctx, wfID); err == nil {
		wfName = wf.Name
	}
	if exec, err := o.store.GetExecution(ctx, execID); err == nil && exec.Title != "" {
		execTitle = exec.Title
	}
	o.eventBus.Publish(ctx, models.NewEvent(execID, nil, "", models.EventTypeExecutionDone,
		fmt.Sprintf("Execution failed: %s", errMsg), map[string]any{"error": errMsg}))
	o.recordActivity(ctx, &models.ActivityEvent{
		WorkforceID:  &wfID,
		ExecutionID:  &execID,
		ActorType:    models.ActorTypeSystem,
		ActorName:    "orchestrator",
		Action:       "execution.failed",
		ResourceType: "execution",
		ResourceID:   execID.String(),
		Summary:      "Execution failed: " + errMsg,
		Metadata:     map[string]any{"error": errMsg, "workforce_name": wfName, "execution_title": execTitle},
	})
}

func (o *Orchestrator) haltExecution(ctx context.Context, execID, wfID uuid.UUID, reason string) {
	o.store.UpdateExecutionStatus(ctx, execID, models.ExecutionStatusHalted)
	o.store.UpdateWorkForceStatus(ctx, wfID, models.WorkForceStatusHalted)
	var wfName, execTitle string
	if wf, err := o.store.GetWorkForce(ctx, wfID); err == nil {
		wfName = wf.Name
	}
	if exec, err := o.store.GetExecution(ctx, execID); err == nil && exec.Title != "" {
		execTitle = exec.Title
	}
	o.eventBus.Publish(ctx, models.NewEvent(execID, nil, "", models.EventTypeExecutionHalted,
		fmt.Sprintf("Execution halted: %s", reason), nil))
	o.recordActivity(ctx, &models.ActivityEvent{
		WorkforceID:  &wfID,
		ExecutionID:  &execID,
		ActorType:    models.ActorTypeSystem,
		ActorName:    "orchestrator",
		Action:       "execution.halted",
		ResourceType: "execution",
		ResourceID:   execID.String(),
		Summary:      "Execution halted: " + reason,
		Metadata:     map[string]any{"reason": reason, "workforce_name": wfName, "execution_title": execTitle},
	})

	// Partial knowledge ingestion: embed agent messages even if execution didn't complete
	if o.knowledgeManager != nil {
		go func() {
			bgCtx := context.Background()
			msgs, err := o.store.GetRecentMessages(bgCtx, execID, 50)
			if err != nil {
				log.Printf("knowledge: get messages for halted exec %s: %v", execID, err)
				return
			}
			o.knowledgeManager.IngestAgentMessages(bgCtx, wfID, execID, msgs)
			log.Printf("knowledge: embedded agent messages for halted execution %s", execID)
		}()
	}
}

func (o *Orchestrator) completeExecution(ctx context.Context, execID, wfID uuid.UUID, result string, tokensUsed int64, iterations int) {
	o.store.UpdateExecutionResult(ctx, execID, result, tokensUsed, iterations)
	o.store.UpdateExecutionStatus(ctx, execID, models.ExecutionStatusCompleted)
	o.store.UpdateWorkForceStatus(ctx, wfID, models.WorkForceStatusCompleted)

	// Enrich activity metadata with human-readable names and title
	var wfName, execTitle string
	if wf, err := o.store.GetWorkForce(ctx, wfID); err == nil {
		wfName = wf.Name
	}
	if exec, err := o.store.GetExecution(ctx, execID); err == nil && exec.Title != "" {
		execTitle = exec.Title
	}
	// If this execution was linked to a kanban task, mark it done
	if task, _ := o.store.FindKanbanTaskByExecutionID(ctx, execID); task != nil {
		done := models.KanbanStatusDone
		o.store.UpdateKanbanTask(ctx, task.ID, models.UpdateKanbanTaskRequest{Status: &done})
	}
	o.eventBus.Publish(ctx, models.NewEvent(execID, nil, "", models.EventTypeExecutionDone,
		fmt.Sprintf("Objective completed after %d iterations. Total tokens: %d", iterations, tokensUsed),
		map[string]any{"result": result, "tokens_used": tokensUsed, "iterations": iterations}))

	o.recordActivity(ctx, &models.ActivityEvent{
		WorkforceID:  &wfID,
		ExecutionID:  &execID,
		ActorType:    models.ActorTypeSystem,
		ActorName:    "orchestrator",
		Action:       "execution.completed",
		ResourceType: "execution",
		ResourceID:   execID.String(),
		Summary:      fmt.Sprintf("Execution completed: %d iterations, %d tokens", iterations, tokensUsed),
		Metadata: map[string]any{
			"tokens_used":     tokensUsed,
			"iterations":      iterations,
			"workforce_name":  wfName,
			"execution_title": execTitle,
		},
	})

	// Auto-embed execution result + agent messages into workforce knowledge base
	if o.knowledgeManager != nil {
		go func() {
			bgCtx := context.Background()
			// Get the execution to retrieve the objective
			exec, err := o.store.GetExecution(bgCtx, execID)
			if err != nil {
				log.Printf("knowledge: get execution for embedding: %v", err)
				return
			}
			// Embed the final result
			if err := o.knowledgeManager.IngestExecutionResult(bgCtx, wfID, execID, exec.Objective, result); err != nil {
				log.Printf("knowledge: embed execution result: %v", err)
			} else {
				log.Printf("knowledge: embedded execution result for %s", execID)
			}
			// Embed significant agent messages
			msgs, err := o.store.GetRecentMessages(bgCtx, execID, 50)
			if err != nil {
				log.Printf("knowledge: get messages for embedding: %v", err)
				return
			}
			o.knowledgeManager.IngestAgentMessages(bgCtx, wfID, execID, msgs)
			log.Printf("knowledge: embedded agent messages for execution %s", execID)
		}()
	}
}

// resolveImageProviderEnv scans the agents' providers for any model of type "image"
// and returns env vars that will be injected into every MCP server for this execution.
// The generate_image tool in Aither-Tools reads these to call the right image API.
func (o *Orchestrator) resolveImageProviderEnv(ctx context.Context, agents []*models.Agent) map[string]string {
	if o.registry == nil {
		return nil
	}
	for _, agent := range agents {
		if agent.ProviderID == nil {
			continue
		}
		provider, err := o.store.GetProvider(ctx, *agent.ProviderID)
		if err != nil || provider == nil {
			continue
		}
		for _, m := range provider.Models {
			if !m.IsEnabled || m.ModelType != models.ModelTypeImage {
				continue
			}
			// Found an image-capable model on this provider — inject env vars
			baseURL := provider.BaseURL
			if baseURL == "" {
				baseURL = "https://generativelanguage.googleapis.com/v1beta"
			}
			env := map[string]string{
				"AITHER_IMAGE_API_KEY":  provider.APIKey,
				"AITHER_IMAGE_BASE_URL": baseURL,
				"AITHER_IMAGE_MODEL":    m.ModelName,
				"AITHER_IMAGE_PROVIDER": string(provider.ProviderType),
			}
			log.Printf("orchestrator: injecting image provider env (provider=%s model=%s)", provider.Name, m.ModelName)
			return env
		}
	}
	return nil
}

// recordActivity is a fire-and-forget helper that logs an activity event.
func (o *Orchestrator) recordActivity(ctx context.Context, evt *models.ActivityEvent) {
	if err := o.store.RecordActivity(ctx, evt); err != nil {
		log.Printf("orchestrator: record activity: %v", err)
	}
}

// InjectIntervention sends a human message into a running execution mid-flight.
// The message is picked up by the pipeline loop on its next iteration.
func (o *Orchestrator) InjectIntervention(executionID uuid.UUID, message string) error {
	val, ok := o.interventionChannels.Load(executionID)
	if !ok {
		return fmt.Errorf("execution %s is not currently running", executionID)
	}
	ch, ok := val.(chan string)
	if !ok {
		return fmt.Errorf("execution %s intervention channel in invalid state", executionID)
	}
	select {
	case ch <- message:
		return nil
	default:
		return fmt.Errorf("intervention channel full — try again shortly")
	}
}

// generateStructuredPlan calls the first available LLM to produce a JSON
// execution plan with subtasks and dependency graph from the agent proposals.
func (o *Orchestrator) generateStructuredPlan(ctx context.Context, exec *models.Execution, wf *models.WorkForce, agents []*models.Agent, strategyText string) []models.ExecutionSubtask {
	if len(agents) == 0 {
		return nil
	}

	// Build agent roster for the prompt
	var rosterLines []string
	for _, a := range agents {
		rosterLines = append(rosterLines, fmt.Sprintf("- ID: %s | Name: %s | Description: %s", a.ID, a.Name, a.Description))
	}

	plannerPrompt := fmt.Sprintf(
		"You are the execution planner for a multi-agent AI system.\n\n"+
			"Objective: %s\n\n"+
			"Available agents:\n%s\n\n"+
			"Agent strategy proposals:\n%s\n\n"+
			"Produce a structured JSON execution plan. Break the objective into concrete subtasks, "+
			"assign each to the most appropriate agent, and define dependencies between steps.\n\n"+
			"Rules:\n"+
			"- Each subtask must be assigned to exactly one agent (use the agent's UUID as agent_id)\n"+
			"- depends_on lists the IDs of subtasks that MUST complete before this one begins\n"+
			"- Subtasks with empty depends_on can run immediately\n"+
			"- Be specific: each subtask description should be a concrete deliverable\n\n"+
			"Respond with ONLY the following JSON (no other text, no markdown fence):\n"+
			`{"plan":[{"id":"1","agent_id":"<uuid>","agent_name":"<name>","subtask":"<description>","depends_on":[]},`+
			`{"id":"2","agent_id":"<uuid>","agent_name":"<name>","subtask":"<description>","depends_on":["1"]}]}`,
		exec.Objective,
		strings.Join(rosterLines, "\n"),
		strategyText,
	)

	// Use the first resolvable agent's engine for the planning LLM call
	var eng engine.Connector
	var modelName string
	for _, a := range agents {
		e, m, err := o.resolveConnector(ctx, a)
		if err == nil {
			eng = e
			modelName = m
			break
		}
	}
	if eng == nil {
		log.Printf("orchestrator: generateStructuredPlan: no engine available")
		return buildSimplePlan(agents, exec.Objective)
	}

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentID:   agents[0].ID,
		AgentName: "planner",
		Message:   plannerPrompt,
		Model:     modelName,
	})
	if err != nil {
		log.Printf("orchestrator: generateStructuredPlan LLM call: %v", err)
		return buildSimplePlan(agents, exec.Objective)
	}

	// Parse the JSON plan
	content := strings.TrimSpace(resp.Content)
	// Strip any accidental markdown fence
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var planResp struct {
		Plan []models.ExecutionSubtask `json:"plan"`
	}
	if err := json.Unmarshal([]byte(content), &planResp); err != nil {
		log.Printf("orchestrator: parse structured plan JSON: %v (content: %.200s)", err, content)
		return buildSimplePlan(agents, exec.Objective)
	}

	if len(planResp.Plan) == 0 {
		return buildSimplePlan(agents, exec.Objective)
	}

	// Initialise status fields
	for i := range planResp.Plan {
		planResp.Plan[i].Status = models.SubtaskPending
	}
	return planResp.Plan
}

// buildSimplePlan creates a minimal sequential plan: one subtask per agent in order.
// Used as a fallback when the LLM fails to produce valid JSON.
func buildSimplePlan(agents []*models.Agent, objective string) []models.ExecutionSubtask {
	plan := make([]models.ExecutionSubtask, len(agents))
	for i, a := range agents {
		deps := []string{}
		if i > 0 {
			deps = []string{fmt.Sprintf("%d", i)}
		}
		plan[i] = models.ExecutionSubtask{
			ID:        fmt.Sprintf("%d", i+1),
			AgentID:   a.ID,
			AgentName: a.Name,
			Subtask:   fmt.Sprintf("[%s] Work on objective: %s", a.Name, objective),
			DependsOn: deps,
			Status:    models.SubtaskPending,
		}
	}
	return plan
}

// findReadySubtasks returns indices of subtasks that are pending and whose
// depends_on subtasks are all done.
func findReadySubtasks(plan []models.ExecutionSubtask) []int {
	doneIDs := map[string]bool{}
	for _, st := range plan {
		if st.Status == models.SubtaskDone {
			doneIDs[st.ID] = true
		}
	}
	var ready []int
	for i, st := range plan {
		if st.Status != models.SubtaskPending {
			continue
		}
		allDepsmet := true
		for _, dep := range st.DependsOn {
			if !doneIDs[dep] {
				allDepsmet = false
				break
			}
		}
		if allDepsmet {
			ready = append(ready, i)
		}
	}
	return ready
}

// allSubtasksDone returns true when every subtask in the plan has status done.
func allSubtasksDone(plan []models.ExecutionSubtask) bool {
	if len(plan) == 0 {
		return false
	}
	for _, st := range plan {
		if st.Status != models.SubtaskDone {
			return false
		}
	}
	return true
}

// buildDeadlockMessage returns a human-readable explanation of why the execution deadlocked:
// which subtasks are blocked (with their error), which are stuck waiting on them.
func buildDeadlockMessage(plan []models.ExecutionSubtask) string {
	var blocked []models.ExecutionSubtask
	blockedIDs := map[string]bool{}
	for _, st := range plan {
		if st.Status == models.SubtaskBlocked {
			blocked = append(blocked, st)
			blockedIDs[st.ID] = true
		}
	}

	msg := "Execution deadlock — no runnable subtasks remain.\n\n"

	if len(blocked) > 0 {
		msg += "Blocked subtasks (root cause):\n"
		for _, st := range blocked {
			reason := st.ErrorMsg
			if reason == "" {
				reason = "unknown error (check execution events for details)"
			} else {
				reason = cleanAPIError(reason)
			}
			msg += fmt.Sprintf("  • [%s] %s — %s: %s\n", st.ID, st.AgentName, truncateStr(st.Subtask, 80), reason)
		}
		msg += "\n"
	}

	var stuck []models.ExecutionSubtask
	for _, st := range plan {
		if st.Status != models.SubtaskPending {
			continue
		}
		for _, dep := range st.DependsOn {
			if blockedIDs[dep] {
				stuck = append(stuck, st)
				break
			}
		}
	}
	if len(stuck) > 0 {
		msg += "Subtasks stuck behind blocked dependencies:\n"
		for _, st := range stuck {
			msg += fmt.Sprintf("  • [%s] %s (%s)\n", st.ID, st.AgentName, truncateStr(st.Subtask, 80))
		}
		msg += "\n"
	}

	msg += "To recover: fix the root cause shown above, then re-launch the execution."
	return msg
}

// cleanAPIError extracts a human-readable message from raw provider error strings.
// Many providers return verbose JSON (OpenRouter, OpenAI); this pulls out the
// "message" field value if present, otherwise returns the first 200 chars.
func cleanAPIError(raw string) string {
	// Try to extract "message":"..." from JSON error bodies
	if idx := strings.Index(raw, `"message":"`); idx >= 0 {
		start := idx + len(`"message":"`)
		end := strings.Index(raw[start:], `"`)
		if end > 0 {
			return raw[start : start+end]
		}
	}
	// Fallback: first line, capped at 200 chars
	if nl := strings.IndexByte(raw, '\n'); nl > 0 {
		raw = raw[:nl]
	}
	if len(raw) > 200 {
		return raw[:200] + "…"
	}
	return raw
}

// isRateLimitError returns true if the error looks like a provider rate-limit response.
func isRateLimitError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "rate limit") ||
		strings.Contains(msg, "secondary rate") ||
		strings.Contains(msg, "free-models-per-day") ||
		strings.Contains(msg, "per_day") ||
		strings.Contains(msg, "429") ||
		strings.Contains(msg, "x-ratelimit")
}

// hasNeedsHelp returns true if any subtask is currently waiting for human input.
func hasNeedsHelp(plan []models.ExecutionSubtask) bool {
	for _, st := range plan {
		if st.Status == models.SubtaskNeedsHelp {
			return true
		}
	}
	return false
}

// buildHandoffContext assembles the outputs of the completed upstream subtasks
// into a formatted context string for injection into the next agent's prompt.
func buildHandoffContext(plan []models.ExecutionSubtask, dependsOn []string) string {
	if len(dependsOn) == 0 {
		return ""
	}
	outputByID := map[string]models.ExecutionSubtask{}
	for _, st := range plan {
		outputByID[st.ID] = st
	}
	var parts []string
	for _, depID := range dependsOn {
		if st, ok := outputByID[depID]; ok && st.Output != "" {
			parts = append(parts, fmt.Sprintf("### Output from %s (subtask %s)\n%s", st.AgentName, st.ID, st.Output))
		}
	}
	return strings.Join(parts, "\n\n")
}

// findAgentByID returns the agent with the given UUID from the slice, or nil.
func findAgentByID(agents []*models.Agent, id uuid.UUID) *models.Agent {
	for _, a := range agents {
		if a.ID == id {
			return a
		}
	}
	return nil
}

// containsStr returns true if slice contains s.
func containsStr(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

// truncateStr truncates s to at most maxLen characters.
func truncateStr(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func resolveModel(agentModel, defaultModel string) string {
	if agentModel != "" {
		return agentModel
	}
	return defaultModel
}

// findLeaderAgent returns the designated leader agent, falling back to the first agent.
func findLeaderAgent(agents []*models.Agent, leaderID *uuid.UUID) *models.Agent {
	if leaderID != nil {
		for _, a := range agents {
			if a.ID == *leaderID {
				return a
			}
		}
	}
	if len(agents) > 0 {
		return agents[0]
	}
	return nil
}

// runDiscussion runs the pre-execution collaborative discussion phase.
// Each non-leader agent contributes their perspective (1 turn), then the leader
// synthesizes into an execution plan. Returns the agreed plan and discussion summary.
// Safety: capped at maxDiscussionTurns total agent turns.
func (o *Orchestrator) runDiscussion(ctx context.Context, exec *models.Execution, wf *models.WorkForce, agents []*models.Agent, leaderAgent *models.Agent) ([]models.ExecutionSubtask, string) {
	const maxDiscussionTurns = 6

	leaderID := leaderAgent.ID
	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &leaderID, leaderAgent.Name,
		models.EventTypeDiscussionStarted,
		fmt.Sprintf("%s is calling the team together for a strategy discussion.", leaderAgent.Name),
		map[string]any{"agents": len(agents), "leader": leaderAgent.Name}))

	// Build team roster string for prompts
	var rosterLines []string
	for _, a := range agents {
		brief := a.Instructions
		if idx := strings.Index(brief, "\n"); idx > 0 {
			brief = brief[:idx]
		}
		if len(brief) > 100 {
			brief = brief[:100]
		}
		toolNote := ""
		if len(a.Tools) > 0 {
			toolNote = fmt.Sprintf(" [tools: %s]", strings.Join(a.Tools, ", "))
		}
		leaderMark := ""
		if a.ID == leaderAgent.ID {
			leaderMark = " ★ LEADER"
		}
		rosterLines = append(rosterLines, fmt.Sprintf("  • %s (ID: %s)%s%s — %s", a.Name, a.ID, leaderMark, toolNote, brief))
	}
	teamRoster := strings.Join(rosterLines, "\n")

	// ── Phase 1: Collect contributions from non-leader agents ──
	var contributions []string
	turnCount := 0

	for _, agent := range agents {
		if agent.ID == leaderAgent.ID {
			continue
		}
		if turnCount >= maxDiscussionTurns-1 {
			break
		}
		// Respect cancellation between turns (e.g. HaltExecution during planning)
		select {
		case <-ctx.Done():
			log.Printf("orchestrator: discussion cancelled after %d turns", turnCount)
			return buildSimplePlan(agents, exec.Objective), "Discussion cancelled"
		default:
		}

		eng, modelName, err := o.resolveConnector(ctx, agent)
		if err != nil {
			log.Printf("orchestrator: discussion: no engine for %s: %v", agent.Name, err)
			continue
		}

		agentID := agent.ID
		systemPrompt, _ := engine.InterpolatePrompt(agent.SystemPrompt, agent.Variables, nil)

		priorCtx := ""
		if len(contributions) > 0 {
			priorCtx = "\n\nYour teammates have already said:\n"
			for _, c := range contributions {
				priorCtx += c + "\n---\n"
			}
		}

		contributionPrompt := fmt.Sprintf(
			"## Team Strategy Discussion\n\n"+
				"**Objective:** %s\n\n"+
				"**Team:**\n%s%s\n\n"+
				"You are **%s**. In 2-3 sentences:\n"+
				"1. State what YOU can contribute to this objective (be specific about your role)\n"+
				"2. Name who should be the primary executor (the agent whose role best fits the bulk of the work)\n"+
				"3. If you are NOT the primary executor, describe the specific help you can offer if asked\n\n"+
				"Be concise and direct. No lengthy explanations.\n\n"+
				"End with:\n```json\n{\"status\": \"contribute\", \"primary_executor\": \"<AgentName>\", \"my_role\": \"<one sentence>\"}\n```",
			exec.Objective, teamRoster, priorCtx, agent.Name,
		)

		o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &agentID, agent.Name,
			models.EventTypeDiscussionTurn,
			fmt.Sprintf("%s is sharing their perspective on the task...", agent.Name), nil))

		promptMsg := &models.Message{
			ID: uuid.New(), ExecutionID: exec.ID, AgentID: &agentID, AgentName: agent.Name,
			Iteration: 0, Phase: models.MessagePhaseDiscussion, Role: models.MessageRoleUser,
			Content: contributionPrompt, Model: modelName, CreatedAt: time.Now(),
		}
		o.store.CreateMessage(ctx, promptMsg)

		resp, err := eng.Submit(ctx, engine.TaskRequest{
			AgentID:      agent.ID,
			AgentName:    agent.Name,
			SystemPrompt: systemPrompt,
			Message:      contributionPrompt,
			Model:        modelName,
		})
		if err != nil {
			log.Printf("orchestrator: discussion contribution from %s: %v", agent.Name, err)
			continue
		}

		respMsg := &models.Message{
			ID: uuid.New(), ExecutionID: exec.ID, AgentID: &agentID, AgentName: agent.Name,
			Iteration: 0, Phase: models.MessagePhaseDiscussion, Role: models.MessageRoleAssistant,
			Content: resp.Content, TokensIn: resp.TokensIn, TokensOut: resp.TokensOut,
			Model: resp.Model, LatencyMs: resp.LatencyMs, CreatedAt: time.Now(),
		}
		o.store.CreateMessage(ctx, respMsg)

		contributions = append(contributions, fmt.Sprintf("[%s]: %s", agent.Name, resp.Content))

		o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &agentID, agent.Name,
			models.EventTypeDiscussionTurn,
			fmt.Sprintf("%s has shared their perspective.", agent.Name),
			map[string]any{"content": truncateStr(resp.Content, 200)}))

		turnCount++
	}

	// ── Phase 2: Leader synthesizes and produces the execution plan ──
	leaderEng, leaderModel, err := o.resolveConnector(ctx, leaderAgent)
	if err != nil {
		log.Printf("orchestrator: discussion: no engine for leader %s: %v", leaderAgent.Name, err)
		return buildSimplePlan(agents, exec.Objective), "Fallback plan (leader engine unavailable)"
	}

	leaderSystemPrompt, _ := engine.InterpolatePrompt(leaderAgent.SystemPrompt, leaderAgent.Variables, nil)

	contributionsText := "(no contributions — you are the sole agent)"
	if len(contributions) > 0 {
		contributionsText = strings.Join(contributions, "\n\n")
	}

	synthPrompt := fmt.Sprintf(
		"## Leadership Synthesis\n\n"+
			"You are **%s**, the team leader. Your team has discussed the following objective:\n\n"+
			"**Objective:** %s\n\n"+
			"**Team roster:**\n%s\n\n"+
			"**Team contributions:**\n%s\n\n"+
			"Based on this discussion, produce the final execution plan. Rules:\n"+
			"- Assign work to the MOST appropriate agent(s) for their expertise\n"+
			"- If one agent can handle everything efficiently, assign ALL subtasks to them (minimize token waste)\n"+
			"- Only include an agent if they add unique value the primary executor cannot provide\n"+
			"- Each subtask must be a concrete, actionable deliverable — not vague\n"+
			"- Keep the plan minimal: fewer steps = faster, cheaper execution\n\n"+
			"Respond with ONLY this JSON (no other text, no markdown fence):\n"+
			`{"plan":[{"id":"1","agent_id":"<uuid>","agent_name":"<name>","subtask":"<concrete description>","depends_on":[]},`+
			`{"id":"2","agent_id":"<uuid>","agent_name":"<name>","subtask":"<concrete description>","depends_on":["1"]}]}`,
		leaderAgent.Name, exec.Objective, teamRoster, contributionsText,
	)

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &leaderID, leaderAgent.Name,
		models.EventTypeDiscussionTurn,
		fmt.Sprintf("%s is synthesizing the discussion and finalizing the execution plan...", leaderAgent.Name), nil))

	synthPromptMsg := &models.Message{
		ID: uuid.New(), ExecutionID: exec.ID, AgentID: &leaderID, AgentName: leaderAgent.Name,
		Iteration: 0, Phase: models.MessagePhaseDiscussion, Role: models.MessageRoleUser,
		Content: synthPrompt, Model: leaderModel, CreatedAt: time.Now(),
	}
	o.store.CreateMessage(ctx, synthPromptMsg)

	synthResp, err := leaderEng.Submit(ctx, engine.TaskRequest{
		AgentID:      leaderAgent.ID,
		AgentName:    leaderAgent.Name,
		SystemPrompt: leaderSystemPrompt,
		Message:      synthPrompt,
		Model:        leaderModel,
	})
	if err != nil {
		log.Printf("orchestrator: discussion: leader synthesis failed: %v", err)
		return buildSimplePlan(agents, exec.Objective), "Fallback plan (leader synthesis failed)"
	}

	synthRespMsg := &models.Message{
		ID: uuid.New(), ExecutionID: exec.ID, AgentID: &leaderID, AgentName: leaderAgent.Name,
		Iteration: 0, Phase: models.MessagePhaseDiscussion, Role: models.MessageRoleAssistant,
		Content: synthResp.Content, TokensIn: synthResp.TokensIn, TokensOut: synthResp.TokensOut,
		Model: synthResp.Model, LatencyMs: synthResp.LatencyMs, CreatedAt: time.Now(),
	}
	o.store.CreateMessage(ctx, synthRespMsg)

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &leaderID, leaderAgent.Name,
		models.EventTypeDiscussionConsensus,
		fmt.Sprintf("%s has finalized the execution plan.", leaderAgent.Name),
		map[string]any{"agents_in_discussion": len(agents)}))

	// Parse JSON plan from leader's synthesis — extract first { ... last } robustly
	content := synthResp.Content
	startIdx := strings.Index(content, "{")
	endIdx := strings.LastIndex(content, "}")
	if startIdx >= 0 && endIdx > startIdx {
		content = content[startIdx : endIdx+1]
	} else {
		content = strings.TrimSpace(content)
	}

	var planResp struct {
		Plan []models.ExecutionSubtask `json:"plan"`
	}
	if err := json.Unmarshal([]byte(content), &planResp); err != nil {
		log.Printf("orchestrator: discussion: parse plan JSON: %v (content: %.300s)", err, content)
		return buildSimplePlan(agents, exec.Objective), "Fallback plan (JSON parse failed)"
	}
	if len(planResp.Plan) == 0 {
		return buildSimplePlan(agents, exec.Objective), "Fallback plan (empty plan from leader)"
	}

	for i := range planResp.Plan {
		planResp.Plan[i].Status = models.SubtaskPending
	}

	// Build human-readable discussion summary for the strategy view
	var summaryParts []string
	for _, c := range contributions {
		summaryParts = append(summaryParts, c)
	}
	summaryParts = append(summaryParts, fmt.Sprintf("[%s (Leader)]: %s", leaderAgent.Name, synthResp.Content))
	discussionSummary := strings.Join(summaryParts, "\n\n---\n\n")

	return planResp.Plan, discussionSummary
}

// runPeerConsultation runs a single LLM call to a peer agent and stores both messages
// with phase='peer_consultation'. Returns the peer's answer.
func (o *Orchestrator) runPeerConsultation(
	ctx context.Context,
	exec *models.Execution,
	callerAgent *models.Agent,
	allAgents []*models.Agent,
	peerName string,
	question string,
) string {
	// Find the peer agent by name (case-insensitive)
	var peer *models.Agent
	for _, a := range allAgents {
		if strings.EqualFold(a.Name, peerName) && a.ID != callerAgent.ID {
			peer = a
			break
		}
	}
	if peer == nil {
		return fmt.Sprintf("(peer '%s' not found in this workforce)", peerName)
	}

	peerID := peer.ID
	callerID := callerAgent.ID

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &callerID, callerAgent.Name,
		models.EventTypePeerConsultation,
		fmt.Sprintf("%s is consulting %s: %s", callerAgent.Name, peer.Name, question),
		map[string]any{"caller": callerAgent.Name, "peer": peer.Name, "question": question}))

	eng, modelName, err := o.resolveConnector(ctx, peer)
	if err != nil {
		return fmt.Sprintf("(could not reach peer %s: %v)", peer.Name, err)
	}

	peerSystemPrompt, _ := engine.InterpolatePrompt(peer.SystemPrompt, peer.Variables, exec.Inputs)
	consultMsg := fmt.Sprintf(
		"Your teammate %s is mid-task and needs a quick answer from you.\n\n"+
			"Objective context: %s\n\n"+
			"Question: %s\n\n"+
			"Reply concisely in 1-3 sentences. No JSON signal needed — just answer the question.",
		callerAgent.Name, exec.Objective, question,
	)

	// Store the consultation prompt
	o.store.CreateMessage(ctx, &models.Message{
		ID: uuid.New(), ExecutionID: exec.ID,
		AgentID: &peerID, AgentName: peer.Name,
		Iteration: 0, Phase: models.MessagePhasePeerConsultation,
		Role:    models.MessageRoleUser,
		Content: fmt.Sprintf("[from %s]: %s", callerAgent.Name, question),
		Model:   modelName, CreatedAt: time.Now(),
	})

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentID:      peer.ID,
		AgentName:    peer.Name,
		SystemPrompt: peerSystemPrompt,
		Message:      consultMsg,
		Model:        modelName,
	})
	if err != nil {
		log.Printf("orchestrator: peer consultation (%s→%s): %v", callerAgent.Name, peer.Name, err)
		return fmt.Sprintf("(peer %s is unavailable: %v)", peer.Name, err)
	}

	// Store the peer's response
	o.store.CreateMessage(ctx, &models.Message{
		ID: uuid.New(), ExecutionID: exec.ID,
		AgentID: &peerID, AgentName: peer.Name,
		Iteration: 0, Phase: models.MessagePhasePeerConsultation,
		Role:      models.MessageRoleAssistant,
		Content:   resp.Content,
		TokensIn:  resp.TokensIn, TokensOut: resp.TokensOut,
		Model:     resp.Model, LatencyMs: resp.LatencyMs, CreatedAt: time.Now(),
	})

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &peerID, peer.Name,
		models.EventTypePeerConsultation,
		fmt.Sprintf("%s replied to %s's consultation.", peer.Name, callerAgent.Name),
		map[string]any{"caller": callerAgent.Name, "peer": peer.Name, "answer_length": len(resp.Content)}))

	return resp.Content
}

// reviewSignal is the structured JSON the leader returns after reviewing the team's output.
type reviewSignal struct {
	Status     string   `json:"status"`     // "review_passed" or "review_needs_revision"
	Summary    string   `json:"summary"`    // Quality assessment (1-2 sentences)
	Highlights []string `json:"highlights"` // What was done well
	Issues     []string `json:"issues"`     // Critical gaps (if review_needs_revision)
}

// runReview runs the post-execution quality review by the leader agent.
// This is advisory — execution always completes regardless of verdict.
// Returns the raw review content to append to the execution result.
func (o *Orchestrator) runReview(
	ctx context.Context,
	exec *models.Execution,
	wf *models.WorkForce,
	agents []*models.Agent,
	leaderAgent *models.Agent,
	plan []models.ExecutionSubtask,
) string {
	leaderID := leaderAgent.ID

	// Respect cancellation before starting
	select {
	case <-ctx.Done():
		return ""
	default:
	}

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &leaderID, leaderAgent.Name,
		models.EventTypeReviewStarted,
		fmt.Sprintf("%s is conducting the post-execution quality review...", leaderAgent.Name),
		map[string]any{"subtasks": len(plan), "leader": leaderAgent.Name}))

	// Build outputs summary for the review prompt
	var outputParts []string
	for _, st := range plan {
		if st.Output != "" {
			summary := st.Output
			if len(summary) > 800 {
				summary = summary[:800] + "...(truncated)"
			}
			outputParts = append(outputParts, fmt.Sprintf("### Subtask %s [%s]\n%s", st.ID, st.AgentName, summary))
		}
	}
	outputsText := strings.Join(outputParts, "\n\n")
	if outputsText == "" {
		outputsText = "(no agent outputs recorded)"
	}

	eng, modelName, err := o.resolveConnector(ctx, leaderAgent)
	if err != nil {
		log.Printf("orchestrator: review: no engine for leader %s: %v", leaderAgent.Name, err)
		return ""
	}

	leaderSystemPrompt, _ := engine.InterpolatePrompt(leaderAgent.SystemPrompt, leaderAgent.Variables, exec.Inputs)

	reviewPrompt := fmt.Sprintf(
		"## Post-Execution Quality Review\n\n"+
			"You are **%s**, the team leader. Your team has just completed the following objective:\n\n"+
			"**Objective:** %s\n\n"+
			"**Team outputs (one section per subtask):**\n%s\n\n"+
			"Review the combined output against the objective. Be lenient — partial completion, minor imperfections, "+
			"and rough formatting are acceptable. Only flag serious failures where the core objective was not addressed.\n\n"+
			"Respond with ONLY this JSON (no other text):\n"+
			`{"status":"review_passed","summary":"<2-3 sentences>","highlights":["<what was done well>"]}`+"\n\n"+
			"OR if there are critical gaps:\n"+
			`{"status":"review_needs_revision","summary":"<what was done>","issues":["<critical gap>"]}`,
		leaderAgent.Name, exec.Objective, outputsText,
	)

	// Store the review prompt
	o.store.CreateMessage(ctx, &models.Message{
		ID: uuid.New(), ExecutionID: exec.ID,
		AgentID: &leaderID, AgentName: leaderAgent.Name,
		Iteration: 0, Phase: models.MessagePhaseReview,
		Role:    models.MessageRoleUser,
		Content: reviewPrompt, Model: modelName, CreatedAt: time.Now(),
	})

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentID:      leaderAgent.ID,
		AgentName:    leaderAgent.Name,
		SystemPrompt: leaderSystemPrompt,
		Message:      reviewPrompt,
		Model:        modelName,
	})
	if err != nil {
		log.Printf("orchestrator: review: leader LLM call failed: %v", err)
		return ""
	}

	// Store the leader's review response
	o.store.CreateMessage(ctx, &models.Message{
		ID: uuid.New(), ExecutionID: exec.ID,
		AgentID: &leaderID, AgentName: leaderAgent.Name,
		Iteration: 0, Phase: models.MessagePhaseReview,
		Role:      models.MessageRoleAssistant,
		Content:   resp.Content,
		TokensIn:  resp.TokensIn, TokensOut: resp.TokensOut,
		Model:     resp.Model, LatencyMs: resp.LatencyMs, CreatedAt: time.Now(),
	})

	// Parse review signal for event metadata
	content := resp.Content
	startIdx := strings.Index(content, "{")
	endIdx := strings.LastIndex(content, "}")
	passed := true
	summary := ""
	if startIdx >= 0 && endIdx > startIdx {
		var sig reviewSignal
		if err := json.Unmarshal([]byte(content[startIdx:endIdx+1]), &sig); err == nil {
			passed = sig.Status != "review_needs_revision"
			summary = sig.Summary
		}
	}
	if summary == "" {
		summary = truncateStr(resp.Content, 200)
	}

	verdict := "passed"
	if !passed {
		verdict = "needs_revision"
	}

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &leaderID, leaderAgent.Name,
		models.EventTypeReviewComplete,
		fmt.Sprintf("%s review complete: %s — %s", leaderAgent.Name, verdict, truncateStr(summary, 120)),
		map[string]any{"passed": passed, "verdict": verdict, "summary": summary}))

	return resp.Content
}

// PreflightCheck is a single validation item returned by Preflight.
type PreflightCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

// PreflightResult is the full response from Preflight.
type PreflightResult struct {
	OK     bool             `json:"ok"`
	Checks []PreflightCheck `json:"checks"`
}

// Preflight validates a workforce configuration before execution without starting anything.
func (o *Orchestrator) Preflight(ctx context.Context, wfID uuid.UUID) PreflightResult {
	checks := []PreflightCheck{}
	allOK := true

	add := func(name string, ok bool, detail string) {
		checks = append(checks, PreflightCheck{Name: name, OK: ok, Detail: detail})
		if !ok {
			allOK = false
		}
	}

	// 1. Load workforce
	wf, err := o.store.GetWorkForce(ctx, wfID)
	if err != nil {
		add("Workforce", false, "Could not load workforce: "+err.Error())
		return PreflightResult{OK: false, Checks: checks}
	}
	add("Workforce", true, fmt.Sprintf("'%s' loaded", wf.Name))

	// 2. Load agents via the same path used during execution
	agents, err := o.loadWorkForceAgents(ctx, wf)
	if err != nil || len(agents) == 0 {
		add("Agents", false, "No agents configured in this workforce")
		return PreflightResult{OK: false, Checks: checks}
	}
	add("Agents", true, fmt.Sprintf("%d agent(s) found", len(agents)))

	// 3. Leader agent (required for multi-agent discussion + review)
	if len(agents) > 1 {
		leader := findLeaderAgent(agents, wf.LeaderAgentID)
		if leader == nil {
			add("Leader agent", false, "No leader set — required for multi-agent discussion and review")
		} else {
			add("Leader agent", true, fmt.Sprintf("'%s' is the team leader", leader.Name))
		}
	} else {
		add("Leader agent", true, "Single-agent mode — no leader required")
	}

	// 4. Provider / model resolution per agent
	failedAgents := []string{}
	for _, a := range agents {
		if _, _, err := o.resolveConnector(ctx, a); err != nil {
			failedAgents = append(failedAgents, a.Name)
		}
	}
	if len(failedAgents) > 0 {
		add("Agent models", false, fmt.Sprintf("No provider configured for: %s", strings.Join(failedAgents, ", ")))
	} else {
		add("Agent models", true, "All agents have a valid LLM provider")
	}

	// 5. Credentials configured
	creds, err := o.store.ListCredentials(ctx, wfID)
	if err == nil {
		if len(creds) == 0 {
			// Check whether any MCP servers are attached — if so, tools likely need creds
			mcpServers, mcpErr := o.store.ListWorkforceMCPServers(ctx, wfID)
			if mcpErr == nil && len(mcpServers) > 0 {
				add("Credentials", false, fmt.Sprintf(
					"No credentials configured but %d MCP server(s) attached — agents may need API keys/tokens to complete tasks. Add them in the Credentials section below.",
					len(mcpServers)))
			} else {
				add("Credentials", true, "No credentials configured (add them if your tasks need API keys)")
			}
		} else {
			services := make([]string, 0, len(creds))
			seen := map[string]bool{}
			for _, c := range creds {
				if !seen[c.Service] {
					services = append(services, c.Service)
					seen[c.Service] = true
				}
			}
			add("Credentials", true, fmt.Sprintf("%d credential(s) ready — services: %s", len(creds), strings.Join(services, ", ")))
		}
	}

	// 6. No active execution already running for this workforce
	execs, _, listErr := o.store.ListExecutions(ctx, wfID, 20, 0)
	if listErr == nil {
		for _, ex := range execs {
			if ex.Status == models.ExecutionStatusRunning || ex.Status == models.ExecutionStatusPlanning {
				add("Active execution", false, fmt.Sprintf("Execution '%s' is already %s", ex.ID, ex.Status))
				return PreflightResult{OK: false, Checks: checks}
			}
		}
	}
	add("Active execution", true, "Workforce is idle — ready to launch")

	return PreflightResult{OK: allOK, Checks: checks}
}

func joinResults(results []string) string {
	if len(results) == 0 {
		return "(none yet)"
	}
	out := ""
	for _, r := range results {
		out += r + "\n\n"
	}
	return out
}

// AnswerQuestion answers a user question about a finished execution using the
// full agent transcript as context. Returns the LLM answer as a string.
func (o *Orchestrator) AnswerQuestion(ctx context.Context, execID uuid.UUID, question string) (string, error) {
	// Load execution
	exec, err := o.store.GetExecution(ctx, execID)
	if err != nil {
		return "", fmt.Errorf("load execution: %w", err)
	}

	// Load agent outputs (execution phase, assistant role only)
	outputs, err := o.store.GetExecutionAgentOutputs(ctx, execID)
	if err != nil {
		return "", fmt.Errorf("load outputs: %w", err)
	}

	// Build compact transcript (truncate each message to 2000 chars)
	var parts []string
	seen := map[string]bool{}
	for _, m := range outputs {
		content := m.Content
		if len(content) > 2000 {
			content = content[:2000] + "...(truncated)"
		}
		key := m.AgentName
		label := m.AgentName
		if !seen[key] {
			seen[key] = true
		}
		parts = append(parts, fmt.Sprintf("### %s (iteration %d)\n%s", label, m.Iteration, content))
	}
	transcript := strings.Join(parts, "\n\n---\n\n")
	if transcript == "" {
		transcript = "(no agent output recorded)"
	}

	// Truncate total transcript to ~12000 chars for context window safety
	if len(transcript) > 12000 {
		transcript = transcript[:12000] + "\n\n...(transcript truncated)"
	}

	systemPrompt := "You are an expert analyst reviewing an AI agent execution. " +
		"Answer the user's question concisely and factually based solely on the execution transcript provided. " +
		"If the answer cannot be determined from the transcript, say so clearly."

	message := fmt.Sprintf(
		"## Execution: %s\n**Objective:** %s\n\n## Agent Transcript\n\n%s\n\n---\n\n## Question\n%s",
		execID, exec.Objective, transcript, question,
	)

	// Resolve connector via default provider
	var eng engine.Connector
	var modelName string

	if o.registry != nil {
		provider, err := o.store.GetDefaultProvider(ctx)
		if err == nil {
			// Pick the first enabled model, or use the orchestrator default
			mn := o.llmConfig.Model
			for _, m := range provider.Models {
				if m.IsEnabled {
					mn = m.ModelName
					break
				}
			}
			conn, _, err2 := o.registry.ResolveByProviderID(ctx, provider.ID, mn)
			if err2 == nil {
				eng = conn
				modelName = mn
			}
		}
	}
	// Fallback to legacy engines map
	if eng == nil {
		for _, e := range o.engines {
			eng = e
			break
		}
		modelName = o.llmConfig.Model
	}
	if eng == nil {
		return "", fmt.Errorf("no LLM engine available")
	}

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentName:    "qa-analyst",
		SystemPrompt: systemPrompt,
		Message:      message,
		Model:        modelName,
	})
	if err != nil {
		return "", fmt.Errorf("llm call: %w", err)
	}
	return resp.Content, nil
}
