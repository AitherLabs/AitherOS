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
	"github.com/google/uuid"
)

// completionSignal is the structured JSON that agents return to signal their state.
type completionSignal struct {
	Status  string `json:"status"`  // "complete", "needs_help", "blocked", or omit to continue
	Summary string `json:"summary"` // Final summary (when status=="complete")
	Reason  string `json:"reason"`  // Explanation for needs_help or blocked
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

	// Ask each agent to contribute to the strategy
	var strategyParts []string
	for _, agent := range agents {
		eng, modelName, err := o.resolveConnector(ctx, agent)
		if err != nil {
			o.eventBus.PublishSystem(ctx, exec.ID, fmt.Sprintf("No engine available for agent '%s': %v, skipping", agent.Name, err))
			continue
		}

		agentID := agent.ID
		o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &agentID, agent.Name, models.EventTypeAgentThinking,
			fmt.Sprintf("%s is analyzing the objective and formulating a strategy...", agent.Name), nil))

		// Interpolate variables into system prompt (use empty inputs for planning)
		systemPrompt, _ := engine.InterpolatePrompt(agent.SystemPrompt, agent.Variables, nil)
		instructions, _ := engine.InterpolatePrompt(agent.Instructions, agent.Variables, nil)

		// Build teammate context: who else is on this team and what do they do
		var teammateLines []string
		for _, teammate := range agents {
			if teammate.ID == agent.ID {
				continue
			}
			brief, _ := engine.InterpolatePrompt(teammate.Instructions, teammate.Variables, nil)
			if idx := strings.Index(brief, "\n"); idx > 0 {
				brief = brief[:idx]
			}
			if len(brief) > 120 {
				brief = brief[:120] + "..."
			}
			toolNote := ""
			if len(teammate.Tools) > 0 {
				toolNote = fmt.Sprintf(" [tools: %s]", strings.Join(teammate.Tools, ", "))
			}
			teammateLines = append(teammateLines, fmt.Sprintf("  • %s%s — %s", teammate.Name, toolNote, brief))
		}
		teamSection := ""
		if len(teammateLines) > 0 {
			teamSection = "YOUR TEAMMATES:\n" + strings.Join(teammateLines, "\n") + "\n\n"
		}

		// Tool context for this agent
		toolSection := "YOUR TOOLS: none assigned for this workforce (work through reasoning and coordination)\n\n"
		if len(agent.Tools) > 0 {
			toolSection = fmt.Sprintf("YOUR TOOLS: %s\n\n", strings.Join(agent.Tools, ", "))
		}

		// Share what previous teammates already proposed (incremental coordination)
		prevSection := ""
		if len(strategyParts) > 0 {
			prevSection = "WHAT YOUR TEAMMATES HAVE ALREADY PROPOSED:\n"
			for _, part := range strategyParts {
				prevSection += part + "\n---\n"
			}
			prevSection += "\nBuild on their proposals — coordinate, don't duplicate.\n\n"
		}

		planPrompt := fmt.Sprintf(
			"You are %s, a specialist agent in a collaborative multi-agent workforce.\n\n"+
				"== MISSION OBJECTIVE ==\n%s\n\n"+
				"== YOUR ROLE & INSTRUCTIONS ==\n%s\n\n"+
				"%s"+ // toolSection
				"%s"+ // teamSection
				"%s"+ // prevSection
				"Now propose YOUR specific contribution to the team strategy:\n"+
				"- Be concise and direct\n"+
				"- Acknowledge what your teammates will handle — don't overlap\n"+
				"- Focus on what YOU uniquely bring to this mission\n"+
				"- List only the information you still need from the human operator to begin",
			agent.Name, exec.Objective, instructions, toolSection, teamSection, prevSection,
		)

		resp, err := eng.Submit(ctx, engine.TaskRequest{
			AgentID:      agent.ID,
			AgentName:    agent.Name,
			SystemPrompt: systemPrompt,
			Instructions: instructions,
			Message:      planPrompt,
			Model:        modelName,
			Tools:        agent.Tools,
		})
		if err != nil {
			o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &agentID, agent.Name, models.EventTypeAgentError,
				fmt.Sprintf("%s failed during planning: %s", agent.Name, err.Error()), nil))
			continue
		}

		// Log planning messages for observability
		promptMsg := &models.Message{
			ID: uuid.New(), ExecutionID: exec.ID, AgentID: &agentID, AgentName: agent.Name,
			Iteration: 0, Role: models.MessageRoleUser, Content: planPrompt,
			Model: modelName, CreatedAt: time.Now(),
		}
		o.store.CreateMessage(ctx, promptMsg)

		responseMsg := &models.Message{
			ID: uuid.New(), ExecutionID: exec.ID, AgentID: &agentID, AgentName: agent.Name,
			Iteration: 0, Role: models.MessageRoleAssistant, Content: resp.Content,
			TokensIn: resp.TokensIn, TokensOut: resp.TokensOut, Model: resp.Model,
			LatencyMs: resp.LatencyMs, CreatedAt: time.Now(),
		}
		o.store.CreateMessage(ctx, responseMsg)

		strategyParts = append(strategyParts, fmt.Sprintf("## %s\n%s", agent.Name, resp.Content))

		o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &agentID, agent.Name, models.EventTypeAgentCompleted,
			fmt.Sprintf("%s has proposed their strategy.", agent.Name), map[string]any{"content": resp.Content}))
	}

	strategy := ""
	for _, part := range strategyParts {
		strategy += part + "\n\n"
	}

	if err := o.store.UpdateExecutionStrategy(ctx, exec.ID, strategy); err != nil {
		log.Printf("orchestrator: update strategy: %v", err)
	}

	// ── Structured Plan Generation ──
	// Use the first available agent's engine to produce a JSON execution plan
	// with subtasks, agent assignments, and dependency graph.
	structuredPlan := o.generateStructuredPlan(ctx, exec, wf, agents, strategy)
	if len(structuredPlan) > 0 {
		if err := o.store.UpdateExecutionPlan(ctx, exec.ID, structuredPlan); err != nil {
			log.Printf("orchestrator: update plan: %v", err)
		}
		exec.Plan = structuredPlan
	}

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
			fmt.Sprintf("Plan rejected by human operator. Feedback: %s", feedback), nil))
		o.recordActivity(ctx, &models.ActivityEvent{
			WorkforceID:  &exec.WorkForceID,
			ExecutionID:  &exec.ID,
			ActorType:    models.ActorTypeUser,
			ActorName:    "operator",
			Action:       "execution.rejected",
			ResourceType: "execution",
			ResourceID:   exec.ID.String(),
			Summary:      "Execution plan rejected",
			Metadata:     map[string]any{"feedback": feedback},
		})
		return o.store.UpdateExecutionStatus(ctx, executionID, models.ExecutionStatusFailed)
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
	go o.runExecutionLoop(exec)

	return nil
}

func (o *Orchestrator) runExecutionLoop(exec *models.Execution) {
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

	// Connect MCP servers for this workforce
	var mcpSession *mcp.Session
	if o.mcpManager != nil {
		sess, mcpCleanup, mcpErr := o.mcpManager.ConnectWorkforceServers(ctx, wf.ID)
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
	// Reset all subtasks to pending at start of execution
	for i := range plan {
		plan[i].Status = models.SubtaskPending
		plan[i].Output = ""
	}
	o.store.UpdateExecutionPlan(ctx, exec.ID, plan)

	o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypeExecutionStarted,
		fmt.Sprintf("Pipeline execution started — %d subtasks queued.", len(plan)),
		map[string]any{"plan": plan}))

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
				o.haltExecution(ctx, exec.ID, wf.ID, "Execution deadlock — no runnable subtasks remain")
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
			} else if res.Complete {
				subtask.Status = models.SubtaskDone
				subtask.Output = res.Content
				o.store.UpdateExecutionPlan(ctx, exec.ID, plan)
				o.completeExecution(ctx, exec.ID, wf.ID, res.Summary, execCtx.tokensUsed.Load(), stepCount+1)
				return
			} else if res.NeedsHelp {
				subtask.Status = models.SubtaskNeedsHelp
				o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &subtask.AgentID, subtask.AgentName,
					models.EventTypeHumanRequired,
					fmt.Sprintf("[%s/%s] Needs human input: %s", subtask.ID, subtask.AgentName, res.NeedsHelpReason),
					map[string]any{"reason": res.NeedsHelpReason, "subtask_id": subtask.ID}))
			} else {
				subtask.Status = models.SubtaskDone
				subtask.Output = res.Content

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
	o.completeExecution(ctx, exec.ID, wf.ID, joinResults(outputs), execCtx.tokensUsed.Load(), stepCount)
}

// runAgentParams holds everything needed to run a single agent subtask.
type runAgentParams struct {
	exec            *models.Execution
	wf              *models.WorkForce
	agent           *models.Agent
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

	taskParts = append(taskParts, "---\n"+
		"Execute your subtask now. Produce your output directly.\n\n"+
		"When your subtask is FULLY complete, include this JSON block:\n"+
		"```json\n{\"status\": \"complete\", \"summary\": \"<one-sentence summary>\"}\n```\n\n"+
		"If you need human input to continue, include:\n"+
		"```json\n{\"status\": \"needs_help\", \"reason\": \"<what you need>\"}\n```\n\n"+
		"If you are blocked by a dependency or error, include:\n"+
		"```json\n{\"status\": \"blocked\", \"reason\": \"<what is blocking you>\"}\n```\n\n"+
		"If your subtask is done but the overall objective requires more work by other agents, do NOT include any JSON signal — just provide your output.")

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
		o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentError,
			fmt.Sprintf("%s encountered an error: %s", agent.Name, err.Error()), nil))
		return agentResult{AgentID: agentID, AgentName: agent.Name, Err: err}
	}

	// ── Tool call feedback loop ──
	const maxToolRounds = 10
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
		for i, tc := range resp.ToolCalls {
			o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeToolCall,
				fmt.Sprintf("%s is calling tool: %s (round %d)", agent.Name, tc.Name, toolRound+1),
				map[string]any{"tool": tc.Name, "args": tc.Args, "round": toolRound + 1}))

			result, toolErr := p.mcpSession.ExecuteToolCall(ctx, p.wf.ID, tc.Name, tc.Args)
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
		val.(*executionContext).cancel()
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
	var agents []*models.Agent
	for _, aid := range wf.AgentIDs {
		agent, err := o.store.GetAgent(ctx, aid)
		if err != nil {
			return nil, fmt.Errorf("get agent %s: %w", aid, err)
		}
		agents = append(agents, agent)
	}
	return agents, nil
}

func (o *Orchestrator) failExecution(ctx context.Context, execID, wfID uuid.UUID, errMsg string) {
	o.store.UpdateExecutionStatus(ctx, execID, models.ExecutionStatusFailed)
	o.store.UpdateWorkForceStatus(ctx, wfID, models.WorkForceStatusFailed)
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
		Metadata:     map[string]any{"error": errMsg},
	})
}

func (o *Orchestrator) haltExecution(ctx context.Context, execID, wfID uuid.UUID, reason string) {
	o.store.UpdateExecutionStatus(ctx, execID, models.ExecutionStatusHalted)
	o.store.UpdateWorkForceStatus(ctx, wfID, models.WorkForceStatusHalted)
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
		Metadata:     map[string]any{"reason": reason},
	})
}

func (o *Orchestrator) completeExecution(ctx context.Context, execID, wfID uuid.UUID, result string, tokensUsed int64, iterations int) {
	o.store.UpdateExecutionResult(ctx, execID, result, tokensUsed, iterations)
	o.store.UpdateExecutionStatus(ctx, execID, models.ExecutionStatusCompleted)
	o.store.UpdateWorkForceStatus(ctx, wfID, models.WorkForceStatusCompleted)
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
		Metadata:     map[string]any{"tokens_used": tokensUsed, "iterations": iterations},
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
	ch := val.(chan string)
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
