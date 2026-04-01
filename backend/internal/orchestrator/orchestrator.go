package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"net/url"
	"os"
	shellexec "os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
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

// virtualPlatformTools are injected into every agent's tool list to give agents
// direct access to AitherOS platform capabilities (Kanban board, etc.).
var virtualPlatformTools = []engine.ToolDefinition{
	{
		Name:        "kanban_create_task",
		Description: "Create a new task on this workforce's Kanban board. Use this to populate the board with planned work items.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"title":       map[string]any{"type": "string", "description": "Short task title (one line)"},
				"description": map[string]any{"type": "string", "description": "Full task description including acceptance criteria, specs, or output path"},
				"priority":    map[string]any{"type": "integer", "description": "Priority 0 (low) to 10 (critical). Default 5.", "default": 5},
			},
			"required": []string{"title"},
		},
	},
	{
		Name:        "kanban_list_tasks",
		Description: "List all current tasks on this workforce's Kanban board. Use this to check existing tasks before creating duplicates.",
		Parameters: map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
	},
}

func (o *Orchestrator) normalizeMediaPlan(ctx context.Context, objective string, plan []models.ExecutionSubtask, agents []*models.Agent) ([]models.ExecutionSubtask, bool) {
	if len(plan) == 0 || len(agents) == 0 {
		return plan, false
	}

	agentByID := make(map[uuid.UUID]*models.Agent, len(agents))
	mediaAgent := make(map[uuid.UUID]bool, len(agents))
	for _, a := range agents {
		agentByID[a.ID] = a
		mediaAgent[a.ID] = isMediaAgent(a)
		if !mediaAgent[a.ID] {
			if eng, _, err := o.resolveConnector(ctx, a); err == nil {
				mediaAgent[a.ID] = engine.IsMediaConnector(eng)
			}
		}
	}

	objectiveReqs := extractMediaOutputRequirements(objective)
	newPlan := make([]models.ExecutionSubtask, 0, len(plan)+len(objectiveReqs))
	replaceDepID := make(map[string]string, len(plan)) // old id -> last replacement id
	changed := false

	for _, st := range plan {
		replaceDepID[st.ID] = st.ID
		agent := agentByID[st.AgentID]
		if agent == nil || !mediaAgent[st.AgentID] {
			newPlan = append(newPlan, st)
			continue
		}

		reqs := extractMediaOutputRequirements(st.Subtask)
		reqs = mergeRequirementDimensions(reqs, objectiveReqs)
		if len(reqs) == 0 && len(objectiveReqs) > 1 && strings.Contains(strings.ToLower(st.Subtask), "generate") {
			reqs = objectiveReqs
		}
		if len(reqs) <= 1 {
			newPlan = append(newPlan, st)
			continue
		}

		changed = true
		prevID := ""
		for i, req := range reqs {
			clone := st
			if i == 0 {
				clone.ID = st.ID
				clone.DependsOn = append([]string(nil), st.DependsOn...)
			} else {
				clone.ID = fmt.Sprintf("%s.%d", st.ID, i+1)
				clone.DependsOn = []string{prevID}
			}
			clone.Subtask = buildSingleOutputMediaSubtask(req.Path, req.Width, req.Height)
			clone.Status = models.SubtaskPending
			clone.Output = ""
			clone.ErrorMsg = ""
			newPlan = append(newPlan, clone)
			prevID = clone.ID
		}
		replaceDepID[st.ID] = prevID
	}

	if !changed {
		return plan, false
	}

	for i := range newPlan {
		if len(newPlan[i].DependsOn) == 0 {
			continue
		}
		seen := map[string]struct{}{}
		rewritten := make([]string, 0, len(newPlan[i].DependsOn))
		for _, dep := range newPlan[i].DependsOn {
			target := dep
			if replacement, ok := replaceDepID[dep]; ok {
				target = replacement
			}
			if _, ok := seen[target]; ok {
				continue
			}
			seen[target] = struct{}{}
			rewritten = append(rewritten, target)
		}
		newPlan[i].DependsOn = rewritten
	}

	return newPlan, true
}

func isMediaAgent(agent *models.Agent) bool {
	if agent == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(agent.ModelType)) {
	case string(models.ModelTypeImage), string(models.ModelTypeVideo), string(models.ModelTypeAudio):
		return true
	default:
		return false
	}
}

func buildSingleOutputMediaSubtask(path string, width, height int) string {
	size := ""
	if width > 0 && height > 0 {
		size = fmt.Sprintf(" (%dx%d)", width, height)
	}
	return fmt.Sprintf("Generate exactly one media asset at `%s`%s. Do not combine multiple assets in one output. Finish only when this path is created.", path, size)
}

func selectSubtaskMediaRequirements(objective, subtask string) []mediaOutputRequirement {
	objectiveReqs := extractMediaOutputRequirements(objective)
	subtaskReqs := extractMediaOutputRequirements(subtask)
	if len(subtaskReqs) > 0 {
		return mergeRequirementDimensions(subtaskReqs, objectiveReqs)
	}
	if len(objectiveReqs) > 0 && strings.Contains(strings.ToLower(subtask), "generate") {
		return objectiveReqs
	}
	return nil
}

func extractMediaOutputRequirements(text string) []mediaOutputRequirement {
	if strings.TrimSpace(text) == "" {
		return nil
	}

	dimensions := map[string][2]int{}
	for _, line := range strings.Split(text, "\n") {
		m := mediaPathDimensionLinePattern.FindStringSubmatch(strings.TrimSpace(line))
		if len(m) != 5 {
			continue
		}
		path := normalizeMediaPath(m[1])
		if path == "" {
			continue
		}
		w, errW := strconv.Atoi(m[3])
		h, errH := strconv.Atoi(m[4])
		if errW != nil || errH != nil {
			continue
		}
		dimensions[strings.ToLower(path)] = [2]int{w, h}
	}

	matches := mediaOutputPathPattern.FindAllString(text, -1)
	if len(matches) == 0 {
		return nil
	}

	seen := map[string]struct{}{}
	reqs := make([]mediaOutputRequirement, 0, len(matches))
	for _, match := range matches {
		path := normalizeMediaPath(match)
		if path == "" || !strings.Contains(path, "/") {
			continue
		}
		key := strings.ToLower(path)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		req := mediaOutputRequirement{Path: path}
		if dim, ok := dimensions[key]; ok {
			req.Width = dim[0]
			req.Height = dim[1]
		}
		reqs = append(reqs, req)
	}

	return reqs
}

func mergeRequirementDimensions(primary, fallback []mediaOutputRequirement) []mediaOutputRequirement {
	if len(primary) == 0 {
		return nil
	}
	if len(fallback) == 0 {
		out := make([]mediaOutputRequirement, len(primary))
		copy(out, primary)
		return out
	}
	byPath := map[string]mediaOutputRequirement{}
	for _, req := range fallback {
		byPath[strings.ToLower(req.Path)] = req
	}
	out := make([]mediaOutputRequirement, len(primary))
	for i, req := range primary {
		if req.Width == 0 || req.Height == 0 {
			if fb, ok := byPath[strings.ToLower(req.Path)]; ok {
				if req.Width == 0 {
					req.Width = fb.Width
				}
				if req.Height == 0 {
					req.Height = fb.Height
				}
			}
		}
		out[i] = req
	}
	return out
}

func normalizeMediaPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	path = strings.Trim(path, "`\"'()[]{}<>,;")
	path = strings.ReplaceAll(path, "\\", "/")
	path = strings.TrimPrefix(path, "./")
	path = strings.TrimPrefix(path, "/workspace/")
	path = strings.TrimPrefix(path, "workspace/")
	path = strings.TrimPrefix(path, "/")
	path = strings.TrimSpace(path)
	if path == "." {
		return ""
	}
	return path
}

func buildSingleOutputMediaPrompt(objective, subtask, handoffCtx, outputPath string) string {
	parts := []string{
		"Create exactly one media asset for the required output path below.",
		fmt.Sprintf("Target output path: %s", outputPath),
		"Do not create a collage or merge multiple states unless the target path explicitly describes a sprite sheet.",
	}
	if objective != "" {
		parts = append(parts, "Objective context:\n"+truncateStr(objective, 1800))
	}
	if subtask != "" {
		parts = append(parts, "Subtask context:\n"+truncateStr(subtask, 1200))
	}
	if handoffCtx != "" {
		parts = append(parts, "Upstream style/context:\n"+truncateStr(handoffCtx, 1200))
	}
	return strings.Join(parts, "\n\n")
}

func buildMediaSpecMessage(prompt, outputPath, aspectRatio string) string {
	if aspectRatio == "" {
		aspectRatio = "1:1"
	}
	return fmt.Sprintf(`{"prompt":%q,"output_path":%q,"aspect_ratio":%q}`, prompt, outputPath, aspectRatio)
}

func inferAspectRatio(width, height int) string {
	if width <= 0 || height <= 0 {
		return "1:1"
	}
	if width == height {
		return "1:1"
	}
	if width > height {
		return "16:9"
	}
	return "9:16"
}

func extractGeneratedMediaPath(content string) string {
	m := mediaGeneratedPathLinePattern.FindStringSubmatch(content)
	if len(m) < 2 {
		return ""
	}
	return normalizeMediaPath(m[1])
}

func validateRequiredMediaFile(workspacePath, outputPath string, width, height int) error {
	cleanPath := normalizeMediaPath(outputPath)
	if cleanPath == "" {
		return fmt.Errorf("empty output path")
	}
	absPath := cleanPath
	if filepath.IsAbs(outputPath) {
		absPath = outputPath
	} else if workspacePath != "" {
		absPath = filepath.Join(workspacePath, cleanPath)
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return fmt.Errorf("file not found at %s: %w", cleanPath, err)
	}
	if info.IsDir() {
		return fmt.Errorf("expected file at %s but found directory", cleanPath)
	}

	if width > 0 && height > 0 && isImagePath(cleanPath) {
		f, err := os.Open(absPath)
		if err != nil {
			return fmt.Errorf("open image %s: %w", cleanPath, err)
		}
		defer f.Close()
		cfg, _, err := image.DecodeConfig(f)
		if err != nil {
			return fmt.Errorf("decode image dimensions for %s: %w", cleanPath, err)
		}
		if cfg.Width != width || cfg.Height != height {
			return fmt.Errorf("dimension mismatch for %s: got %dx%d, want %dx%d", cleanPath, cfg.Width, cfg.Height, width, height)
		}
	}

	return nil
}

func isImagePath(path string) bool {
	path = strings.ToLower(path)
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".gif"} {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return false
}

var workspaceArtifactPathPattern = regexp.MustCompile("/workspace/[^\\s\"'`,;\\)\\]\\}]+")

var mediaOutputPathPattern = regexp.MustCompile(`(?i)[a-z0-9_./\\-]+\.(png|jpe?g|webp|gif|bmp|svg|mp4|mov|webm|mkv|mp3|wav|ogg|flac|m4a)`)
var mediaPathDimensionLinePattern = regexp.MustCompile(`(?i)^\s*[-*]\s*` + "`?" + `([a-z0-9_./\\-]+\.(png|jpe?g|webp|gif|bmp|svg))` + "`?" + `\s*\((\d{2,4})\s*[x×]\s*(\d{2,4})\)\s*$`)
var mediaGeneratedPathLinePattern = regexp.MustCompile(`(?im)^path:\s*([^\s]+)`)

const executionModeInputKey = "__execution_mode"
const executionAgentIDInputKey = "__execution_agent_id"

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

// handlePlatformTool intercepts virtual platform tool calls (Kanban, etc.) before
// they are dispatched to MCP. Returns the result string and true if handled.
func (o *Orchestrator) handlePlatformTool(ctx context.Context, wfID uuid.UUID, agentName string, tc engine.ToolCallInfo) (string, bool) {
	str := func(v any) string {
		if s, ok := v.(string); ok {
			return s
		}
		return ""
	}
	intVal := func(v any, def int) int {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		}
		return def
	}

	switch tc.Name {
	case "kanban_create_task":
		title := str(tc.Args["title"])
		if title == "" {
			return "Error: title is required", true
		}
		priority := intVal(tc.Args["priority"], 5)
		desc := str(tc.Args["description"])
		task, err := o.store.CreateKanbanTask(ctx, wfID, models.CreateKanbanTaskRequest{
			Title:       title,
			Description: desc,
			Priority:    priority,
			CreatedBy:   agentName,
		})
		if err != nil {
			return fmt.Sprintf("Error creating task: %s", err.Error()), true
		}
		return fmt.Sprintf(`{"ok":true,"task_id":%q,"title":%q,"status":"open"}`, task.ID.String(), task.Title), true

	case "kanban_list_tasks":
		tasks, err := o.store.ListKanbanTasks(ctx, wfID)
		if err != nil {
			return fmt.Sprintf("Error listing tasks: %s", err.Error()), true
		}
		if len(tasks) == 0 {
			return `{"tasks":[],"count":0}`, true
		}
		out := fmt.Sprintf(`{"count":%d,"tasks":[`, len(tasks))
		for i, t := range tasks {
			if i > 0 {
				out += ","
			}
			out += fmt.Sprintf(`{"id":%q,"title":%q,"status":%q,"priority":%d}`,
				t.ID.String(), t.Title, t.Status, t.Priority)
		}
		out += `]}`
		return out, true
	}
	return "", false
}

// completionSignal is the structured JSON that agents return to signal their state.
type completionSignal struct {
	Status    string `json:"status"`   // "complete", "needs_help", "blocked", "ask_peer", or omit to continue
	Summary   string `json:"summary"`  // Final summary (when status=="complete")
	Reason    string `json:"reason"`   // Explanation for needs_help or blocked
	PeerAgent string `json:"peer"`     // Peer agent name to consult (when status=="ask_peer")
	Question  string `json:"question"` // Question to ask the peer (when status=="ask_peer")
}

// maxConversationMemory is the number of recent messages to include as context.
const defaultMaxConversationMemory = 24

// maxHandoffChars is the max chars from a single upstream agent's output to include in handoff context.
const maxHandoffChars = 3000

// maxDiscussionContribChars caps each agent's discussion contribution stored for
// subsequent agents and for the leader's synthesis prompt.
const maxDiscussionContribChars = 500

// maxRAGContextChars caps the total RAG/episodic-memory text injected per agent call.
const maxRAGContextChars = 2000

// maxBriefContextChars caps the project brief text injected per agent call.
// The brief can grow large over time; 6000 chars ≈ 1500 tokens is generous but bounded.
const maxBriefContextChars = 6000

// maxSkillsContextChars caps the combined skills text injected per agent call (~1000 tokens).
const maxSkillsContextChars = 4000

// maxToolResultHistoryChars caps tool results stored in the chat history to avoid
// multi-round context blowup (the full result is still returned to the agent in the
// current round — only subsequent rounds see the truncated version).
const maxToolResultHistoryChars = 4000

// maxToolHistoryMessages is the max number of non-anchor messages retained in
// the rolling tool-call history. Older rounds are evicted to prevent context
// explosion on long-running agents. The first two messages (system prompt +
// initial user task) are always kept as anchors regardless of this cap.
const defaultMaxToolHistoryMessages = 120

// maxConversationMessageChars caps each historical message included in
// conversation context to prevent oversized prompt fragments.
const defaultMaxConversationMessageChars = 4000

// needsHelpPollInterval is how often the execution loop re-checks for human
// intervention while one or more subtasks are in needs_help.
const defaultNeedsHelpPollInterval = 3 * time.Second

// maxNeedsHelpWait is the maximum wall time an execution may remain paused on
// needs_help before it is halted and surfaced to the operator explicitly.
const defaultMaxNeedsHelpWait = 15 * time.Minute

// needsHelpReminderInterval controls how often a reminder event is emitted
// while waiting for operator intervention.
const defaultNeedsHelpReminderInterval = 60 * time.Second

// mediaInterFileWait adds a short controlled pause between sequential file
// generations for media subtasks to improve provider stability/coherence.
const defaultMediaInterFileWait = 1200 * time.Millisecond

// maxAgentToolRounds caps tool-call feedback loops per subtask to prevent
// runaway multi-minute tool churn.
const defaultMaxAgentToolRounds = 24

// maxInterventionContextChars caps the accumulated operator intervention text
// injected into a single execution round.
const defaultMaxInterventionContextChars = 4000

var (
	// ORCH_MAX_CONVERSATION_MEMORY: number of recent execution messages to inject.
	maxConversationMemory = envInt("ORCH_MAX_CONVERSATION_MEMORY", defaultMaxConversationMemory, 8, 300)
	// ORCH_MAX_TOOL_HISTORY_MESSAGES: rolling tool-call history depth.
	maxToolHistoryMessages = envInt("ORCH_MAX_TOOL_HISTORY_MESSAGES", defaultMaxToolHistoryMessages, 40, 600)
	// ORCH_MAX_CONVERSATION_MESSAGE_CHARS: per-message cap for convo context.
	maxConversationMessageChars = envInt("ORCH_MAX_CONVERSATION_MESSAGE_CHARS", defaultMaxConversationMessageChars, 1000, 12000)

	// ORCH_NEEDS_HELP_POLL_INTERVAL: sleep between needs_help checks.
	needsHelpPollInterval = envDuration("ORCH_NEEDS_HELP_POLL_INTERVAL", defaultNeedsHelpPollInterval, 500*time.Millisecond)
	// ORCH_NEEDS_HELP_TIMEOUT: auto-halt timeout while waiting for intervention.
	maxNeedsHelpWait = envDuration("ORCH_NEEDS_HELP_TIMEOUT", defaultMaxNeedsHelpWait, 30*time.Second)
	// ORCH_NEEDS_HELP_REMINDER_INTERVAL: reminder cadence while paused.
	needsHelpReminderInterval = envDuration("ORCH_NEEDS_HELP_REMINDER_INTERVAL", defaultNeedsHelpReminderInterval, 5*time.Second)
	// ORCH_MEDIA_INTER_FILE_WAIT: delay between per-file media generations.
	mediaInterFileWait = envDuration("ORCH_MEDIA_INTER_FILE_WAIT", defaultMediaInterFileWait, 0)
	// ORCH_MAX_TOOL_ROUNDS: hard cap for tool-loop rounds per agent subtask.
	maxAgentToolRounds = envInt("ORCH_MAX_TOOL_ROUNDS", defaultMaxAgentToolRounds, 4, 120)

	// ORCH_MAX_INTERVENTION_CONTEXT_CHARS: max accumulated operator instructions.
	maxInterventionContextChars = envInt("ORCH_MAX_INTERVENTION_CONTEXT_CHARS", defaultMaxInterventionContextChars, 500, 20000)
	// ORCH_AUTONOMOUS_OBJECTIVE_FALLBACK: run workforce objective when no kanban TODO exists.
	autonomousObjectiveFallbackEnabled = envBool("ORCH_AUTONOMOUS_OBJECTIVE_FALLBACK", false)
)

// trimHistory keeps history[0] (system prompt) and history[1] (user task) as
// anchors, then retains only the most recent maxToolHistoryMessages messages.
// The cut always falls on an assistant-message boundary to avoid orphaning
// tool-result messages whose corresponding assistant message has been dropped.
func trimHistory(history []engine.ChatMessage) []engine.ChatMessage {
	const anchors = 2
	if len(history) <= anchors+maxToolHistoryMessages {
		return history
	}
	cutFrom := len(history) - maxToolHistoryMessages
	// Walk forward to find the nearest assistant message boundary so we never
	// orphan tool results from their paired assistant message.
	for cutFrom < len(history) && history[cutFrom].Role != "assistant" {
		cutFrom++
	}
	if cutFrom >= len(history) {
		return history
	}
	trimmed := make([]engine.ChatMessage, anchors, anchors+(len(history)-cutFrom))
	copy(trimmed, history[:anchors])
	return append(trimmed, history[cutFrom:]...)
}

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
	briefRefreshInFlight sync.Map // projectID -> struct{}
}

type LLMConfig struct {
	APIBase string
	APIKey  string
	Model   string
}

type executionContext struct {
	cancel      context.CancelFunc
	workforceID uuid.UUID
	tokensUsed  atomic.Int64
	iterations  atomic.Int32
}

type planningBudgetTracker struct {
	maxTokens  int64
	usedTokens int64
	alerted    bool
}

func newPlanningBudgetTracker(exec *models.Execution, wf *models.WorkForce) *planningBudgetTracker {
	maxTokens := wf.BudgetTokens
	if maxTokens <= 0 {
		maxTokens = 2_000_000
	}
	usedTokens := exec.TokensUsed
	if usedTokens < 0 {
		usedTokens = 0
	}
	return &planningBudgetTracker{maxTokens: maxTokens, usedTokens: usedTokens}
}

func (p *planningBudgetTracker) exhausted() bool {
	if p == nil || p.maxTokens <= 0 {
		return false
	}
	return p.usedTokens >= p.maxTokens
}

func (o *Orchestrator) consumePlanningTokens(ctx context.Context, execID uuid.UUID, planningBudget *planningBudgetTracker, resp *engine.TaskResponse, source string) {
	if planningBudget == nil || resp == nil {
		return
	}
	delta := resp.TokensIn + resp.TokensOut
	if delta <= 0 {
		delta = resp.TokensUsed
	}
	if delta <= 0 {
		return
	}
	planningBudget.usedTokens += delta
	if err := o.store.IncrementExecutionTokens(ctx, execID, delta); err != nil {
		log.Printf("orchestrator: increment planning tokens for %s: %v", execID, err)
	}
	if planningBudget.exhausted() && !planningBudget.alerted {
		planningBudget.alerted = true
		o.eventBus.PublishSystem(ctx, execID,
			fmt.Sprintf("Planning token budget exhausted after %s (%d/%d tokens).", source, planningBudget.usedTokens, planningBudget.maxTokens))
	}
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

type mediaOutputRequirement struct {
	Path   string
	Width  int
	Height int
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
	return o.startExecution(ctx, workforceID, objective, inputs, models.ExecutionModeAllAgents, nil)
}

// StartExecutionWithOptions starts an execution with explicit orchestration mode.
// single_agent mode requires an agent ID in the same workforce and bypasses HitL approval.
func (o *Orchestrator) StartExecutionWithOptions(
	ctx context.Context,
	workforceID uuid.UUID,
	objective string,
	inputs map[string]string,
	mode models.ExecutionMode,
	agentID *uuid.UUID,
) (*models.Execution, error) {
	return o.startExecution(ctx, workforceID, objective, inputs, mode, agentID)
}

func (o *Orchestrator) startExecution(
	ctx context.Context,
	workforceID uuid.UUID,
	objective string,
	inputs map[string]string,
	mode models.ExecutionMode,
	agentID *uuid.UUID,
) (*models.Execution, error) {
	wf, previousStatus, claimed, err := o.store.TryClaimWorkForceExecutionSlot(ctx, workforceID)
	if err != nil {
		return nil, fmt.Errorf("claim workforce execution slot: %w", err)
	}
	if !claimed {
		return nil, fmt.Errorf("workforce %s is already active (status: %s)", workforceID, previousStatus)
	}

	claimedSlot := true
	defer func() {
		if !claimedSlot {
			return
		}
		if restoreErr := o.store.UpdateWorkForceStatus(context.Background(), workforceID, previousStatus); restoreErr != nil {
			log.Printf("orchestrator: restore workforce status after failed start (%s -> %s): %v", workforceID, previousStatus, restoreErr)
		}
	}()

	execInputs := buildExecutionInputs(inputs, mode, agentID)
	exec, err := o.store.CreateExecution(ctx, workforceID, objective, execInputs)
	if err != nil {
		return nil, fmt.Errorf("create execution: %w", err)
	}

	// Move to planning phase
	if err := o.store.UpdateExecutionStatus(ctx, exec.ID, models.ExecutionStatusPlanning); err != nil {
		return nil, fmt.Errorf("update exec status: %w", err)
	}
	exec.Status = models.ExecutionStatusPlanning

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
	o.activeExecs.Store(exec.ID, &executionContext{cancel: planCancel, workforceID: workforceID})

	// Run planning asynchronously
	go o.runPlanning(exec, wf, planCtx)
	claimedSlot = false

	return exec, nil
}

func (o *Orchestrator) runPlanning(exec *models.Execution, wf *models.WorkForce, ctx context.Context) {
	defer o.activeExecs.Delete(exec.ID)
	planningBudget := newPlanningBudgetTracker(exec, wf)

	agents, err := o.resolveExecutionAgents(ctx, wf, exec)
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
		structuredPlan, strategy = o.runDiscussion(ctx, exec, wf, agents, leaderAgent, planningBudget)
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
	if planningBudget.exhausted() {
		o.haltExecution(ctx, exec.ID, wf.ID, "Token budget exhausted during planning phase")
		return
	}

	if normalizedPlan, changed := o.normalizeMediaPlan(ctx, exec.Objective, structuredPlan, agents); changed {
		structuredPlan = normalizedPlan
		o.eventBus.PublishSystem(ctx, exec.ID,
			fmt.Sprintf("Media orchestration normalized: split into %d per-file subtasks.", len(structuredPlan)))
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

	// Direct mode: single-agent workforces skip title generation and strategy
	// summarization (both LLM calls) — the agent goes straight to execution.
	// Multi-agent workforces still generate title + summary for the approval card.
	isDirectMode := len(agents) == 1

	var approvalSummary string
	if isDirectMode {
		// Derive title from objective without an LLM call.
		title := exec.Objective
		if len(title) > 60 {
			title = title[:60] + "…"
		}
		if err := o.store.UpdateExecutionMeta(ctx, exec.ID, models.UpdateExecutionMetaRequest{Title: &title}); err != nil {
			log.Printf("orchestrator: set direct-mode title: %v", err)
		}
		o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypeExecutionTitled,
			fmt.Sprintf("Execution named: %s", title), map[string]any{"title": title}))
	} else {
		o.generateAndSetTitle(ctx, exec.ID, wf, agents, strategy, exec.Objective, planningBudget)
		if planningBudget.exhausted() {
			o.haltExecution(ctx, exec.ID, wf.ID, "Token budget exhausted during planning phase")
			return
		}
		approvalSummary = o.summarizeStrategy(ctx, exec.ID, wf, agents, strategy, exec.Objective, planningBudget)
		if planningBudget.exhausted() {
			o.haltExecution(ctx, exec.ID, wf.ID, "Token budget exhausted during planning phase")
			return
		}
	}

	if isDirectMode || shouldAutoRunWithoutApproval(exec, wf) {
		msg := "Direct mode: single agent — skipping approval, starting execution immediately."
		if !isDirectMode {
			msg = "Single-agent mode selected. Skipping approval and starting execution."
			if wf.AutonomousMode {
				msg = "Autonomous mode enabled. Auto-approving strategy and starting execution."
			}
		}
		o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypePlanApproved,
			msg,
			map[string]any{"mode": executionModeFromInputs(exec.Inputs)}))
		go o.runExecutionLoop(exec, false)
		return
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

	// Create a formal approval request for plan review
	wfID := wf.ID
	approvalReq := &models.CreateApprovalRequest{
		ExecutionID: &exec.ID,
		ActionType:  models.ApprovalActionExecutionStart,
		Title:       fmt.Sprintf("Approve execution plan for '%s'", wf.Name),
		Description: approvalSummary,
		Confidence:  0.0,
		RequestedBy: "orchestrator",
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
func (o *Orchestrator) summarizeStrategy(ctx context.Context, execID uuid.UUID, wf *models.WorkForce, agents []*models.Agent, strategy, objective string, planningBudget *planningBudgetTracker) string {
	if strategy == "" || len(agents) == 0 {
		return fmt.Sprintf("%d agent(s) have proposed their strategies. Review and approve to begin execution.", len(agents))
	}
	if planningBudget.exhausted() {
		return fmt.Sprintf("%d agent(s) have proposed their strategies for this mission. Review the Strategy Session above, then approve or reject.", len(agents))
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
	o.consumePlanningTokens(ctx, execID, planningBudget, resp, "strategy summarization")
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

// generateAndSetTitle makes a small LLM call to produce a 4-7 word
// human-readable title for the execution, persists it, and fires an
// execution_titled event.
func (o *Orchestrator) generateAndSetTitle(ctx context.Context, execID uuid.UUID, wf *models.WorkForce, agents []*models.Agent, strategy, objective string, planningBudget *planningBudgetTracker) {
	if planningBudget.exhausted() {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
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
		log.Printf("orchestrator: generateAndSetTitle: no resolvable text engine for exec %s", execID)
		return
	}
	// Skip media connectors — they can't generate text
	if engine.IsMediaConnector(eng) {
		// Try remaining candidates for a text engine
		eng = nil
		modelName = ""
		for _, a := range candidates {
			e, m, err := o.resolveConnector(ctx, a)
			if err == nil && !engine.IsMediaConnector(e) {
				eng = e
				modelName = m
				break
			}
		}
		if eng == nil {
			log.Printf("orchestrator: generateAndSetTitle: no text engine found (only media agents) for exec %s", execID)
			return
		}
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
	o.consumePlanningTokens(ctx, execID, planningBudget, resp, "title generation")
	if err != nil {
		log.Printf("orchestrator: generateAndSetTitle LLM error (exec %s, model %s): %v", execID, modelName, err)
		return
	}
	if resp == nil || strings.TrimSpace(resp.Content) == "" {
		log.Printf("orchestrator: generateAndSetTitle empty response (exec %s, model %s)", execID, modelName)
		return
	}

	title := strings.TrimSpace(resp.Content)
	// Strip surrounding quotes and markdown bold/italic markers
	title = strings.Trim(title, `"'*_`)
	title = strings.TrimSpace(title)
	// Strip a trailing period
	title = strings.TrimRight(title, ".")
	// Hard cap
	runes := []rune(title)
	if len(runes) > 80 {
		title = string(runes[:80])
	}

	if title == "" {
		log.Printf("orchestrator: generateAndSetTitle title empty after cleanup (exec %s)", execID)
		return
	}

	log.Printf("orchestrator: generated title for exec %s: %q", execID, title)
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
		o.activeExecs.Store(exec.ID, &executionContext{cancel: planCancel, workforceID: exec.WorkForceID})
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
	execCtx := &executionContext{cancel: cancel, workforceID: exec.WorkForceID}
	execCtx.tokensUsed.Store(exec.TokensUsed)
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

	agents, err := o.resolveExecutionAgents(ctx, wf, exec)
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

	// ── Docker execution environment ──────────────────────────────────────────
	// If this workforce has a docker_image set, spin up a container for the
	// entire execution. All agents share the same container — packages installed
	// by one tool call are visible to subsequent calls. The container is stopped
	// when the execution completes, halts, or errors.
	wsPath := workspace.WorkspacePath(wf.Name)
	if wf.DockerImage != "" {
		containerName, dockerErr := startExecutionContainer(ctx, exec.ID, wf.DockerImage, wsPath)
		if dockerErr != nil {
			log.Printf("orchestrator: docker start for %s: %v", exec.ID, dockerErr)
			o.eventBus.PublishSystem(ctx, exec.ID,
				fmt.Sprintf("Docker container failed to start (%s): %v — running without container.", wf.DockerImage, dockerErr))
		} else {
			defer stopExecutionContainer(containerName, wsPath)
			o.eventBus.PublishSystem(ctx, exec.ID,
				fmt.Sprintf("Docker container started: %s (image: %s)", containerName, wf.DockerImage))
		}
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
	if normalizedPlan, changed := o.normalizeMediaPlan(ctx, exec.Objective, plan, agents); changed {
		plan = normalizedPlan
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
	var needsHelpSince time.Time
	var lastNeedsHelpReminder time.Time

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
		for {
			var msg string
			select {
			case msg = <-interventCh:
			default:
				msg = ""
			}
			if msg == "" {
				break
			}

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

			pendingIntervention = appendInterventionMessage(pendingIntervention, msg)
			// Unblock any waiting subtasks
			for i := range plan {
				if plan[i].Status == models.SubtaskNeedsHelp || plan[i].Status == models.SubtaskBlocked {
					plan[i].Status = models.SubtaskPending
					plan[i].ErrorMsg = ""
				}
			}
			o.store.UpdateExecutionPlan(ctx, exec.ID, plan)
			o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypeHumanIntervened,
				"Human intervened: "+msg,
				map[string]any{"message": msg}))
		}

		// ── Pause if waiting for human ──
		if hasNeedsHelp(plan) {
			now := time.Now()
			if needsHelpSince.IsZero() {
				needsHelpSince = now
				lastNeedsHelpReminder = now
				o.eventBus.PublishSystem(ctx, exec.ID,
					fmt.Sprintf("Execution paused: waiting for human input. Send a message to continue (auto-halt after %s).", maxNeedsHelpWait))
			} else if now.Sub(lastNeedsHelpReminder) >= needsHelpReminderInterval {
				elapsed := now.Sub(needsHelpSince).Round(time.Second)
				remaining := (maxNeedsHelpWait - now.Sub(needsHelpSince)).Round(time.Second)
				if remaining < 0 {
					remaining = 0
				}
				o.eventBus.PublishSystem(ctx, exec.ID,
					fmt.Sprintf("Still waiting for human input (%s elapsed, %s until auto-halt).", elapsed, remaining))
				lastNeedsHelpReminder = now
			}

			if now.Sub(needsHelpSince) >= maxNeedsHelpWait {
				reason := firstNeedsHelpReason(plan)
				haltMsg := fmt.Sprintf("No human intervention received after %s while waiting in needs_help.", maxNeedsHelpWait)
				if reason != "" {
					haltMsg += " Last request: " + truncateStr(reason, 220)
				}
				o.haltExecution(ctx, exec.ID, wf.ID, haltMsg)
				return
			}

			select {
			case <-ctx.Done():
				o.haltExecution(context.Background(), exec.ID, wf.ID, "Manual halt requested")
				return
			case <-time.After(needsHelpPollInterval):
			}
			continue
		}
		needsHelpSince = time.Time{}
		lastNeedsHelpReminder = time.Time{}

		// ── Find ready subtasks (deps met, status=pending) ──
		ready := findReadySubtasks(plan)
		if len(ready) == 0 {
			// Deadlock: nothing runnable and not all done
			if !allSubtasksDone(plan) {
				o.haltExecution(ctx, exec.ID, wf.ID, buildDeadlockMessage(plan))
			}
			return
		}

		// ── Execute ready subtasks in parallel ──
		// Subtasks in `ready` have all dependencies met — they're truly independent
		// and safe to run concurrently. We mark all as Running upfront, fan out into
		// goroutines, then apply results sequentially after the WaitGroup drains.
		interventionForRound := pendingIntervention

		type runnableEntry struct {
			idx   int
			agent *models.Agent
		}
		var runnable []runnableEntry
		for _, subtaskIdx := range ready {
			plan[subtaskIdx].Status = models.SubtaskRunning
			plan[subtaskIdx].ErrorMsg = ""
			agent := findAgentByID(agents, plan[subtaskIdx].AgentID)
			if agent == nil {
				plan[subtaskIdx].Status = models.SubtaskBlocked
				plan[subtaskIdx].ErrorMsg = fmt.Sprintf("agent %s not found in this workforce", plan[subtaskIdx].AgentID)
				o.eventBus.PublishSystem(ctx, exec.ID,
					fmt.Sprintf("Agent %s not found for subtask %s — blocked", plan[subtaskIdx].AgentID, plan[subtaskIdx].ID))
				continue
			}
			o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &plan[subtaskIdx].AgentID, plan[subtaskIdx].AgentName,
				models.EventTypeSubtaskStarted,
				fmt.Sprintf("[%s/%s] Starting: %s", plan[subtaskIdx].ID, plan[subtaskIdx].AgentName, truncateStr(plan[subtaskIdx].Subtask, 100)),
				map[string]any{"subtask_id": plan[subtaskIdx].ID, "subtask": plan[subtaskIdx].Subtask, "depends_on": plan[subtaskIdx].DependsOn}))
			runnable = append(runnable, runnableEntry{idx: subtaskIdx, agent: agent})
		}
		o.store.UpdateExecutionPlan(ctx, exec.ID, plan)

		type subtaskBatchResult struct {
			subtaskIdx int
			res        agentResult
		}
		batchResults := make([]subtaskBatchResult, len(runnable))
		var batchWg sync.WaitGroup
		for i, entry := range runnable {
			i, entry := i, entry
			subtask := plan[entry.idx] // copy — each goroutine owns its snapshot
			batchWg.Add(1)
			go func() {
				defer batchWg.Done()
				handoffCtx := buildHandoffContext(plan, subtask.DependsOn)
				convCtx := o.buildConversationContext(ctx, exec.ID, wf.ID, exec.Objective)
				res := o.runAgentTask(ctx, runAgentParams{
					exec:            exec,
					wf:              wf,
					agent:           entry.agent,
					allAgents:       agents,
					iteration:       stepCount + 1,
					subtask:         &subtask,
					handoffCtx:      handoffCtx,
					interventionMsg: interventionForRound,
					convCtx:         convCtx,
					mcpSession:      mcpSession,
					execCtx:         execCtx,
				})
				batchResults[i] = subtaskBatchResult{subtaskIdx: entry.idx, res: res}
			}()
		}
		batchWg.Wait()

		// Apply results sequentially — goroutines are done, plan writes are safe.
		usedInterventionThisRound := false
		for _, br := range batchResults {
			subtask := &plan[br.subtaskIdx]
			res := br.res
			if interventionForRound != "" {
				usedInterventionThisRound = true
			}

			if res.Err != nil {
				subtask.Status = models.SubtaskNeedsHelp
				subtask.ErrorMsg = res.Err.Error()
				o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &subtask.AgentID, subtask.AgentName,
					models.EventTypeHumanRequired,
					fmt.Sprintf("[%s] Agent error — execution paused. Use 'Send message' to retry or provide guidance: %s", subtask.AgentName, res.Err.Error()),
					map[string]any{"reason": res.Err.Error(), "subtask_id": subtask.ID}))
			} else if res.NeedsHelp {
				subtask.Status = models.SubtaskNeedsHelp
				subtask.ErrorMsg = strings.TrimSpace(res.NeedsHelpReason)
				if subtask.ErrorMsg == "" {
					subtask.ErrorMsg = "Agent requested human input"
				}
				o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &subtask.AgentID, subtask.AgentName,
					models.EventTypeHumanRequired,
					fmt.Sprintf("[%s/%s] Needs human input: %s", subtask.ID, subtask.AgentName, subtask.ErrorMsg),
					map[string]any{"reason": subtask.ErrorMsg, "subtask_id": subtask.ID}))
			} else {
				subtask.Status = models.SubtaskDone
				subtask.ErrorMsg = ""
				if res.Summary != "" {
					subtask.Output = res.Summary + "\n\n" + res.Content
				} else {
					subtask.Output = res.Content
				}

				o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &subtask.AgentID, subtask.AgentName,
					models.EventTypeSubtaskDone,
					fmt.Sprintf("[%s/%s] Subtask complete", subtask.ID, subtask.AgentName),
					map[string]any{"subtask_id": subtask.ID, "tokens": res.Tokens}))

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

			stepCount++
			execCtx.iterations.Add(1)
			o.eventBus.Publish(ctx, models.NewEvent(exec.ID, nil, "", models.EventTypeIterationDone,
				fmt.Sprintf("Step %d complete. Tokens: %d", stepCount, execCtx.tokensUsed.Load()),
				map[string]any{"step": stepCount, "tokens_used": execCtx.tokensUsed.Load()}))
		}
		o.store.UpdateExecutionPlan(ctx, exec.ID, plan)
		if usedInterventionThisRound {
			pendingIntervention = ""
		}
	}

	// All subtasks done — collect outputs
	var outputs []string
	for _, st := range plan {
		if st.Output != "" {
			outputs = append(outputs, fmt.Sprintf("[%s - %s]:\n%s", st.ID, st.AgentName, st.Output))
		}
	}

	// Build a workspace file manifest from tool call events so the review and final
	// result reflect what was ACTUALLY produced on disk, not just agent text signals.
	// This prevents false "no output" verdicts when agents write files without
	// mentioning them explicitly in their completion summaries.
	var wsManifest string
	if events, err := o.store.ListExecutionEvents(ctx, exec.ID); err == nil {
		wsPath := workspace.WorkspacePath(wf.Name)
		report := buildDeliveryReport(events, wsPath)
		if len(report.Files) > 0 {
			lines := make([]string, 0, len(report.Files))
			for _, f := range report.Files {
				if f.SizeBytes > 0 {
					lines = append(lines, fmt.Sprintf("  - %s (%s)", f.Path, humanSize(f.SizeBytes)))
				} else {
					lines = append(lines, "  - "+f.Path)
				}
			}
			wsManifest = "**Files written to workspace:**\n" + strings.Join(lines, "\n")
		}
	}

	// P3: Post-execution quality review by leader (multi-agent only, advisory)
	leaderAgent := findLeaderAgent(agents, wf.LeaderAgentID)
	if leaderAgent != nil && len(agents) > 1 {
		o.runReview(ctx, exec, wf, agents, leaderAgent, plan, wsManifest)
	}

	finalResult := joinResults(outputs)
	if wsManifest != "" {
		finalResult = strings.TrimSpace(finalResult)
		if finalResult == "" || finalResult == "(none yet)" {
			finalResult = wsManifest
		} else {
			finalResult += "\n\n" + wsManifest
		}
	}
	o.completeExecution(ctx, exec.ID, wf.ID, finalResult, execCtx.tokensUsed.Load(), stepCount)
}

// containerNameForExec returns the deterministic Docker container name for an execution.
func containerNameForExec(execID uuid.UUID) string {
	return "aitheros-" + execID.String()
}

// startExecutionContainer starts a Docker container for the execution and writes
// the container name to <workspace>/.aither_container so MCP tools can discover it.
func startExecutionContainer(ctx context.Context, execID uuid.UUID, dockerImage, workspacePath string) (string, error) {
	name := containerNameForExec(execID)
	cmd := shellexec.CommandContext(ctx, "docker", "run",
		"-d",
		"--name", name,
		"--network", "host",
		"-v", workspacePath+":/workspace",
		"-w", "/workspace",
		dockerImage,
		"sleep", "infinity",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("docker run %s: %w: %s", dockerImage, err, strings.TrimSpace(string(out)))
	}
	containerFile := filepath.Join(workspacePath, ".aither_container")
	if werr := os.WriteFile(containerFile, []byte(name), 0644); werr != nil {
		return "", fmt.Errorf("write .aither_container: %w", werr)
	}
	return name, nil
}

// stopExecutionContainer stops and removes the Docker container and cleans up
// the workspace marker file. Errors are intentionally swallowed — cleanup is
// best-effort and should not affect the execution result.
func stopExecutionContainer(containerName, workspacePath string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	shellexec.CommandContext(ctx, "docker", "stop", "-t", "5", containerName).Run() //nolint:errcheck
	shellexec.CommandContext(ctx, "docker", "rm", "-f", containerName).Run()        //nolint:errcheck
	os.Remove(filepath.Join(workspacePath, ".aither_container"))                    //nolint:errcheck
}

// runAgentParams holds everything needed to run a single agent subtask.
type runAgentParams struct {
	exec            *models.Execution
	wf              *models.WorkForce
	agent           *models.Agent
	allAgents       []*models.Agent // all agents in the workforce — needed for ask_peer (P2)
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

	// ── Skills injection ─────────────────────────────────────────────────────
	// Load skills assigned to this agent and build the ## Skills section.
	// Skills are procedural knowledge blocks ("how to SEO-write", "pentest methodology")
	// injected after the project brief, before the assigned subtask.
	skillsCtx := ""
	if agentSkills, err := o.store.GetAgentSkills(ctx, agentID); err == nil && len(agentSkills) > 0 {
		var parts []string
		total := 0
		for _, sk := range agentSkills {
			block := fmt.Sprintf("### %s %s\n%s", sk.Icon, sk.Name, sk.Content)
			if total+len(block) > maxSkillsContextChars {
				parts = append(parts, fmt.Sprintf("*[%d additional skill(s) omitted — context budget reached]*", len(agentSkills)-len(parts)))
				break
			}
			parts = append(parts, block)
			total += len(block)
		}
		skillsCtx = strings.Join(parts, "\n\n---\n\n")
	}

	// ── Per-agent episodic memory from Qdrant ──
	// Retrieve what this specific agent has done in past executions (long-term memory)
	agentMemoryCtx := ""
	projectFactsCtx := ""
	if o.knowledgeManager != nil {
		subtaskQuery := p.exec.Objective
		if p.subtask != nil {
			subtaskQuery = p.subtask.Subtask
		}
		mem, err := o.knowledgeManager.RetrieveRelevantForAgent(ctx, agentID, subtaskQuery, 3)
		if err != nil {
			log.Printf("orchestrator: agent memory retrieval (%s): %v", agent.Name, err)
		} else if mem != "" {
			if len(mem) > maxRAGContextChars {
				mem = mem[:maxRAGContextChars] + fmt.Sprintf("\n… (truncated, %d chars total)", len(mem))
			}
			agentMemoryCtx = mem
		}
		// Retrieve project-scoped facts if this execution belongs to a project
		if p.exec.ProjectID != nil && *p.exec.ProjectID != uuid.Nil {
			facts, ferr := o.knowledgeManager.RetrieveProjectFacts(ctx, *p.exec.ProjectID, subtaskQuery, 5)
			if ferr != nil {
				log.Printf("orchestrator: project facts retrieval (%s): %v", agent.Name, ferr)
			} else if facts != "" {
				if len(facts) > maxRAGContextChars {
					facts = facts[:maxRAGContextChars] + fmt.Sprintf("\n… (truncated, %d chars total)", len(facts))
				}
				projectFactsCtx = facts
			}
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

	// ── Project Brief injection ───────────────────────────────────────────────
	// If this execution belongs to a project, inject its living state document.
	// This replaces the need for agents to re-scan directories or rediscover known state.
	if p.exec.ProjectID != nil && *p.exec.ProjectID != uuid.Nil {
		if proj, err := o.store.GetProject(ctx, *p.exec.ProjectID); err == nil && proj.Brief != "" {
			brief := proj.Brief
			if len(brief) > maxBriefContextChars {
				brief = brief[:maxBriefContextChars] + fmt.Sprintf("\n… (truncated, %d chars total)", len(proj.Brief))
			}
			taskParts = append(taskParts, fmt.Sprintf("## Project Brief\n%s", brief))
		}
	}
	if projectFactsCtx != "" {
		taskParts = append(taskParts, fmt.Sprintf("## Project Knowledge (relevant facts)\n%s", projectFactsCtx))
	}
	if skillsCtx != "" {
		taskParts = append(taskParts, fmt.Sprintf("## Your Skills\n%s", skillsCtx))
	}

	subtaskDescPart := fmt.Sprintf("## Your Assigned Subtask (step %d)\n%s", p.iteration, subtaskDesc)
	taskParts = append(taskParts, subtaskDescPart)

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
	toolRoundBudget := maxAgentToolRounds
	if agent.MaxIterations > 0 && agent.MaxIterations < toolRoundBudget {
		toolRoundBudget = agent.MaxIterations
	}
	if toolRoundBudget < 4 {
		toolRoundBudget = 4
	}

	// Pre-fetch workspace snapshot and available secrets so agents don't waste
	// tool rounds on list_directory / list_secrets discovery at the start of every subtask.
	wsSnapshot := buildWorkspaceSnapshot(workspacePath)
	secretsLines := buildSecretsSnapshot(ctx, o.store, p.wf.ID)

	wsSection := fmt.Sprintf(
		"## Your Workspace\n"+
			"Path: `%s`\n\n"+
			"This is your dedicated workspace — treat it exactly like a local development machine:\n"+
			"- Full read/write access. Create, edit, delete files freely.\n"+
			"- Use `run_command` to run git, npm, python, cargo, curl, bash scripts — anything.\n"+
			"- Clone repos here, run builds, write output files. Files persist for this workforce.\n"+
			"- Prefer local workspace/repo files first; fetch from GitHub only when the file is not available locally.\n"+
			"- `/workspace/` is an alias for your workspace root — use it in tool paths (e.g. `/workspace/output.md`).",
		workspacePath)
	if wsSnapshot != "" {
		wsSection += "\n\n**Current workspace contents:**\n" + wsSnapshot
	}
	wsSection += "\n\n**Credentials** — call `get_secret(service, key)` directly. You do NOT need to call `list_secrets()` first.\n" + secretsLines +
		"\nIf a credential you need is not listed above, signal `needs_help` with the exact service and key name."
	taskParts = append(taskParts, wsSection)

	instructionsFooter := fmt.Sprintf("---\n"+
		"Execute your subtask now using efficient cycles: plan → act → verify.\n"+
		"Tool budget: up to %d tool rounds for this subtask.\n"+
		"Efficiency policy:\n"+
		"- Workspace contents and credentials are listed above — do NOT call list_directory or list_secrets at the start.\n"+
		"- Avoid repeating the same failing call; after 2 failed attempts, switch approach or signal `needs_help`.\n"+
		"- Prefer focused reads/searches over broad scans.\n"+
		"- Use http_request directly for all API calls — do NOT write Python/shell scripts for API interactions.\n"+
		"Kanban: `kanban_list_tasks()` / `kanban_create_task(title, description, priority)` to manage the board.\n\n"+
		"When done:\n```json\n{\"status\": \"complete\", \"summary\": \"<one sentence>\"}\n```\n"+
		"Need human input:\n```json\n{\"status\": \"needs_help\", \"reason\": \"<what you tried and need>\"}\n```\n"+
		"Hard blocker:\n```json\n{\"status\": \"blocked\", \"reason\": \"<what is blocking>\"}\n```"+
		peerList, toolRoundBudget)
	taskParts = append(taskParts, instructionsFooter)

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

	if engine.IsMediaConnector(eng) {
		return o.runMediaSubtask(ctx, p, eng, modelName, systemPrompt, instructions, workspacePath, taskMsg)
	}

	// Resolve MCP tool definitions for this agent
	var toolDefs []engine.ToolDefinition
	if o.mcpManager != nil {
		toolDefs = o.mcpManager.ResolveAgentToolDefs(ctx, p.wf.ID, agent.ID)
	}
	// Append virtual platform tools (Kanban, etc.) and signal tools so LLMs
	// that prefer function-calling can use both without going through MCP.
	toolDefs = append(toolDefs, virtualPlatformTools...)
	toolDefs = append(toolDefs, virtualSignalTools...)

	// streamSubmit wraps SubmitWithStream to emit live agent_token events per
	// content chunk. Falls back to Submit if streaming fails (e.g., provider
	// does not support streaming with tools).
	var currentStreamID string
	streamSubmit := func(req engine.TaskRequest) (*engine.TaskResponse, error) {
		sid := uuid.New().String()
		currentStreamID = sid
		firstChunk := true
		isJSONResp := false
		result, err := eng.SubmitWithStream(ctx, req, func(chunk string) {
			if firstChunk {
				firstChunk = false
				if t := strings.TrimSpace(chunk); strings.HasPrefix(t, "{") || strings.HasPrefix(t, "```json") {
					isJSONResp = true
				}
			}
			if isJSONResp {
				return
			}
			o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name,
				models.EventTypeAgentToken, chunk,
				map[string]any{"stream_id": sid, "chunk": chunk},
			))
		})
		if err != nil {
			currentStreamID = ""
			return eng.Submit(ctx, req)
		}
		return result, nil
	}

	resp, err := streamSubmit(engine.TaskRequest{
		AgentID:       agent.ID,
		AgentName:     agent.Name,
		SystemPrompt:  systemPrompt,
		Instructions:  instructions,
		Message:       taskMsg,
		Model:         modelName,
		WorkspacePath: workspacePath,
		Tools:         agent.Tools,
		ToolDefs:      toolDefs,
	})
	if err != nil {
		cleanErr := cleanAPIError(err.Error())
		o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentError,
			fmt.Sprintf("%s encountered an error: %s", agent.Name, cleanErr), nil))
		// All LLM errors are surfaced as needs_help so the execution pauses and the
		// user can intervene (switch model, retry, provide context) rather than
		// deadlocking the execution with an unrecoverable blocked subtask.
		return agentResult{
			AgentID:         agentID,
			AgentName:       agent.Name,
			NeedsHelp:       true,
			NeedsHelpReason: fmt.Sprintf("LLM provider error on first call: %s — check the agent's model/provider and use 'Send message' to retry.", cleanErr),
		}
	}

	// ── Tool call feedback loop ──
	maxToolRounds := toolRoundBudget
	var allToolCalls []engine.ToolCallInfo
	var totalTokensIn, totalTokensOut, totalLatency int64
	toolErrorCounts := map[string]int{} // per-tool consecutive error tracking
	const tokenNudge50k = 50_000
	const tokenNudge100k = 100_000
	tokenNudgeFired := map[int]bool{} // tracks which thresholds have fired

	sysContent := systemPrompt
	if instructions != "" {
		sysContent += "\n\n## Instructions\n" + instructions
	}
	// Build an ultra-compact history anchor for tool-loop rounds. The agent
	// already processed the full context (brief, skills, memory, handoff,
	// workspace snapshot, credentials) in round 0. Subsequent rounds only need
	// to remember the subtask and where to write output.
	var compactParts []string
	compactParts = append(compactParts, subtaskDescPart)
	if p.interventionMsg != "" {
		compactParts = append(compactParts, fmt.Sprintf("## Human Operator Instruction\n%s", p.interventionMsg))
	}
	compactParts = append(compactParts, fmt.Sprintf("## Your Workspace\nPath: `%s`", workspacePath))
	compactParts = append(compactParts, instructionsFooter)
	taskMsgCompact := strings.Join(compactParts, "\n\n")

	history := []engine.ChatMessage{
		{Role: "system", Content: sysContent},
		{Role: "user", Content: taskMsgCompact},
	}

	// publishThinking emits the agent's reasoning text as a thinking event so users
	// can see the chain-of-thought in the execution timeline.
	publishThinking := func(content string, round int) {
		text := strings.TrimSpace(content)
		if text == "" {
			return
		}
		if strings.HasPrefix(text, "{") || strings.HasPrefix(text, "```json") {
			return
		}
		if len(text) > 4000 {
			text = text[:4000] + "\n…[truncated]"
		}
		data := map[string]any{"round": round, "thinking": true}
		if currentStreamID != "" {
			data["stream_id"] = currentStreamID
		}
		o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name,
			models.EventTypeAgentThinking, text, data,
		))
	}

	// Emit initial reasoning — what the agent said before its first tool call.
	publishThinking(resp.Content, 0)

	for toolRound := 0; toolRound < maxToolRounds && len(resp.ToolCalls) > 0; toolRound++ {
		// First pass: check for virtual signal tools (mutate resp, must be sequential).
		signalled := false
		for _, tc := range resp.ToolCalls {
			if handleVirtualSignalTool(tc, resp) {
				o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeToolCall,
					fmt.Sprintf("%s signalled via %s", agent.Name, tc.Name),
					map[string]any{"tool": tc.Name, "args": tc.Args}))
				signalled = true
				break
			}
		}
		if signalled {
			break
		}

		// Deduplicate tool calls within this round (same tool + identical args).
		// Some models occasionally emit the same call twice in one response; skip dupes.
		{
			seen := make(map[string]bool, len(resp.ToolCalls))
			deduped := resp.ToolCalls[:0]
			for _, tc := range resp.ToolCalls {
				key := tc.Name + "\x00" + fmt.Sprintf("%v", tc.Args)
				if seen[key] {
					o.eventBus.PublishSystem(ctx, p.exec.ID,
						fmt.Sprintf("%s: skipping duplicate tool call %s (same args as sibling call)", agent.Name, tc.Name))
					continue
				}
				seen[key] = true
				deduped = append(deduped, tc)
			}
			resp.ToolCalls = deduped
		}

		// Second pass: execute all tool calls concurrently.
		// Each goroutine writes to its own index in resp.ToolCalls — no shared state.
		var wg sync.WaitGroup
		for i := range resp.ToolCalls {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				tc := resp.ToolCalls[i]

				// Platform tools (Kanban, Knowledge, etc.)
				if platformResult, handled := o.handlePlatformTool(ctx, p.wf.ID, agent.Name, tc); handled {
					resp.ToolCalls[i].Result = platformResult
					o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeToolCall,
						fmt.Sprintf("%s called platform tool: %s", agent.Name, tc.Name),
						map[string]any{"tool": tc.Name, "args": tc.Args, "result": platformResult}))
					return
				}

				o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeToolCall,
					fmt.Sprintf("%s is calling tool: %s (round %d)", agent.Name, tc.Name, toolRound+1),
					map[string]any{"tool": tc.Name, "args": tc.Args, "round": toolRound + 1}))

				if p.mcpSession == nil {
					resp.ToolCalls[i].Result = fmt.Sprintf("Error: tool %q requires MCP — no MCP server is connected to this agent", tc.Name)
					return
				}
				result, toolErr := p.mcpSession.ExecuteToolCall(ctx, p.wf.ID, tc.Name, tc.Args)
				// Retry once on rate-limit errors (GitHub secondary rate limit needs ~60s)
				if toolErr != nil && isRateLimitError(toolErr) {
					o.eventBus.PublishSystem(ctx, p.exec.ID,
						fmt.Sprintf("%s: rate limit hit on %s — waiting 62s before retry", agent.Name, tc.Name))
					select {
					case <-time.After(62 * time.Second):
					case <-ctx.Done():
						resp.ToolCalls[i].Result = "Error: execution cancelled during rate-limit wait"
						return
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
			}(i)
		}
		wg.Wait()

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
			result := tc.Result
			if len(result) > maxToolResultHistoryChars {
				result = result[:maxToolResultHistoryChars] + fmt.Sprintf("\n… (truncated, %d chars total)", len(tc.Result))
			}
			history = append(history, engine.ChatMessage{
				Role:       "tool",
				Content:    result,
				ToolCallID: tc.ID,
			})
			// Track per-tool error counts; inject nudge when a tool keeps failing.
			if strings.HasPrefix(tc.Result, "Error:") {
				toolErrorCounts[tc.Name]++
				if toolErrorCounts[tc.Name] == 3 {
					nudge := fmt.Sprintf(
						"SYSTEM NOTICE: Tool '%s' has returned an error %d times. "+
							"Stop using it for this task. Try a different approach, use a different tool, "+
							"or signal `needs_help` with what you've tried so far.", tc.Name, toolErrorCounts[tc.Name])
					o.eventBus.PublishSystem(ctx, p.exec.ID,
						fmt.Sprintf("%s: injecting error-tool nudge for %s", agent.Name, tc.Name))
					history = append(history, engine.ChatMessage{Role: "user", Content: nudge})
				}
			} else {
				toolErrorCounts[tc.Name] = 0 // reset on success
			}
		}

		// Token budget warnings — remind the agent to wrap up as context grows.
		totalTokensSoFar := int(totalTokensIn + totalTokensOut)
		for _, threshold := range []int{tokenNudge50k, tokenNudge100k} {
			if totalTokensSoFar >= threshold && !tokenNudgeFired[threshold] {
				tokenNudgeFired[threshold] = true
				urgency := "approaching"
				if threshold == tokenNudge100k {
					urgency = "well past"
				}
				history = append(history, engine.ChatMessage{
					Role: "user",
					Content: fmt.Sprintf(
						"SYSTEM NOTICE: You are %s %d tokens of context used in this subtask. "+
							"Wrap up soon: deliver a partial result, signal `complete` with what you have, "+
							"or signal `needs_help` if you're blocked. Do not continue indefinitely.", urgency, threshold),
				})
			}
		}

		// Detect tool-call loops and inject a corrective intervention before the next LLM call.
		if loopMsg := detectToolLoop(allToolCalls); loopMsg != "" {
			o.eventBus.PublishSystem(ctx, p.exec.ID,
				fmt.Sprintf("%s: tool loop detected — injecting intervention", agent.Name))
			history = append(history, engine.ChatMessage{
				Role:    "user",
				Content: loopMsg,
			})
		}

		// Retry the tool-loop Submit up to 2 times on transient provider errors.
		var toolLoopErr error
		for attempt := 0; attempt <= 2; attempt++ {
			if attempt > 0 {
				backoff := time.Duration(attempt*5) * time.Second
				o.eventBus.PublishSystem(ctx, p.exec.ID,
					fmt.Sprintf("%s: provider error on tool round %d, retrying in %s (attempt %d/2)…", agent.Name, toolRound+1, backoff, attempt))
				select {
				case <-time.After(backoff):
				case <-ctx.Done():
					toolLoopErr = ctx.Err()
					break
				}
			}
			resp, toolLoopErr = streamSubmit(engine.TaskRequest{
				AgentID:   agent.ID,
				AgentName: agent.Name,
				Model:     modelName,
				Tools:     agent.Tools,
				ToolDefs:  toolDefs,
				History:   trimHistory(history),
			})
			if toolLoopErr == nil {
				break
			}
		}
		// Emit reasoning text the agent produced after seeing this round's tool results.
		if toolLoopErr == nil {
			publishThinking(resp.Content, toolRound+1)
		}
		if toolLoopErr != nil {
			cleanErr := cleanAPIError(toolLoopErr.Error())
			o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentError,
				fmt.Sprintf("%s tool loop failed after retries (round %d): %s", agent.Name, toolRound+1, cleanErr), nil))
			// Surface as needs_help so the execution pauses instead of deadlocking.
			return agentResult{
				AgentID:         agentID,
				AgentName:       agent.Name,
				NeedsHelp:       true,
				NeedsHelpReason: fmt.Sprintf("LLM provider crashed during tool call round %d: %s — check the agent's model/provider and use 'Send message' to retry.", toolRound+1, cleanErr),
			}
		}
	}

	// Guard: resp should never be nil here, but defend anyway.
	if resp == nil {
		return agentResult{
			AgentID:         agentID,
			AgentName:       agent.Name,
			NeedsHelp:       true,
			NeedsHelpReason: "LLM returned an empty response after tool calls — use 'Send message' to retry.",
		}
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

		resp, err = streamSubmit(engine.TaskRequest{
			AgentID:   agent.ID,
			AgentName: agent.Name,
			Model:     modelName,
			Tools:     agent.Tools,
			ToolDefs:  toolDefs,
			History:   trimHistory(history),
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

func (o *Orchestrator) runMediaSubtask(
	ctx context.Context,
	p runAgentParams,
	eng engine.Connector,
	modelName, systemPrompt, instructions, workspacePath, fallbackMessage string,
) agentResult {
	agent := p.agent
	agentID := agent.ID
	requirements := selectSubtaskMediaRequirements(p.exec.Objective, p.subtask.Subtask)
	if len(requirements) == 0 {
		requirements = []mediaOutputRequirement{{}}
	}

	var totalTokensIn, totalTokensOut, totalTokensUsed, totalLatency int64
	contentParts := make([]string, 0, len(requirements))
	validatedPaths := make([]string, 0, len(requirements))

	for i, req := range requirements {
		message := fallbackMessage
		if req.Path != "" {
			message = buildMediaSpecMessage(
				buildSingleOutputMediaPrompt(p.exec.Objective, p.subtask.Subtask, p.handoffCtx, req.Path),
				req.Path,
				inferAspectRatio(req.Width, req.Height),
			)
		}

		o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentActing,
			fmt.Sprintf("%s is generating media %d/%d...", agent.Name, i+1, len(requirements)),
			map[string]any{"output_path": req.Path, "index": i + 1, "total": len(requirements)}))

		resp, err := eng.Submit(ctx, engine.TaskRequest{
			AgentID:       agent.ID,
			AgentName:     agent.Name,
			SystemPrompt:  systemPrompt,
			Instructions:  instructions,
			Message:       message,
			Model:         modelName,
			WorkspacePath: workspacePath,
		})
		if err != nil {
			return agentResult{
				AgentID:         agentID,
				AgentName:       agent.Name,
				NeedsHelp:       true,
				NeedsHelpReason: fmt.Sprintf("media generation failed for %q: %v", req.Path, err),
			}
		}

		contentParts = append(contentParts, strings.TrimSpace(resp.Content))
		totalTokensIn += resp.TokensIn
		totalTokensOut += resp.TokensOut
		totalTokensUsed += resp.TokensUsed
		totalLatency += resp.LatencyMs

		reportedPath := req.Path
		if reportedPath == "" {
			reportedPath = extractGeneratedMediaPath(resp.Content)
		}
		if reportedPath != "" {
			if err := validateRequiredMediaFile(workspacePath, reportedPath, req.Width, req.Height); err != nil {
				return agentResult{
					AgentID:         agentID,
					AgentName:       agent.Name,
					NeedsHelp:       true,
					NeedsHelpReason: fmt.Sprintf("validation failed for required media output %q: %v", reportedPath, err),
				}
			}
			validatedPaths = append(validatedPaths, reportedPath)
		} else if req.Path != "" {
			return agentResult{
				AgentID:         agentID,
				AgentName:       agent.Name,
				NeedsHelp:       true,
				NeedsHelpReason: fmt.Sprintf("media provider did not report a generated path for required output %q", req.Path),
			}
		}

		if i < len(requirements)-1 && mediaInterFileWait > 0 {
			select {
			case <-ctx.Done():
				return agentResult{AgentID: agentID, AgentName: agent.Name, Err: ctx.Err()}
			case <-time.After(mediaInterFileWait):
			}
		}
	}

	content := strings.TrimSpace(strings.Join(contentParts, "\n\n"))
	if len(validatedPaths) > 0 {
		content = fmt.Sprintf("Generated media files: %s\n\n%s", strings.Join(validatedPaths, ", "), content)
	}

	responseMsg := &models.Message{
		ID:          uuid.New(),
		ExecutionID: p.exec.ID,
		AgentID:     &agentID,
		AgentName:   agent.Name,
		Iteration:   p.iteration,
		Role:        models.MessageRoleAssistant,
		Content:     content,
		TokensIn:    totalTokensIn,
		TokensOut:   totalTokensOut,
		Model:       modelName,
		LatencyMs:   totalLatency,
		CreatedAt:   time.Now(),
	}
	if err := o.store.CreateMessage(ctx, responseMsg); err != nil {
		log.Printf("orchestrator: log media response message: %v", err)
	}

	tokensForCall := totalTokensIn + totalTokensOut
	if tokensForCall == 0 {
		tokensForCall = totalTokensUsed
	}
	p.execCtx.tokensUsed.Add(tokensForCall)
	o.store.IncrementExecutionTokens(ctx, p.exec.ID, tokensForCall)

	o.eventBus.Publish(ctx, models.NewEvent(p.exec.ID, &agentID, agent.Name, models.EventTypeAgentCompleted,
		fmt.Sprintf("%s completed their subtask.", agent.Name),
		map[string]any{
			"content":       content,
			"tokens_total":  tokensForCall,
			"tokens_input":  totalTokensIn,
			"tokens_output": totalTokensOut,
			"model":         modelName,
			"latency_ms":    totalLatency,
			"outputs":       validatedPaths,
		}))

	if o.knowledgeManager != nil {
		o.knowledgeManager.IngestSingleMessage(ctx, p.wf.ID, p.exec.ID, &agentID,
			agent.Name, p.iteration, content, modelName)
	}

	summary := ""
	if len(validatedPaths) > 0 {
		summary = fmt.Sprintf("Generated %d media file(s): %s", len(validatedPaths), strings.Join(validatedPaths, ", "))
	}

	return agentResult{
		AgentID:   agentID,
		AgentName: agent.Name,
		Content:   content,
		Tokens:    tokensForCall,
		Complete:  true,
		Summary:   summary,
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
			if len(ragCtx) > maxRAGContextChars {
				ragCtx = ragCtx[:maxRAGContextChars] + fmt.Sprintf("\n… (truncated, %d chars total)", len(ragCtx))
			}
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
		if len(content) > maxConversationMessageChars {
			content = truncateStr(content, maxConversationMessageChars) + "... (truncated)"
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
		// Skip if workforce is already in an active state or awaiting human input.
		// Also skip terminal halt/fail states to prevent autonomous retry loops.
		if wf.Status == models.WorkForceStatusExecuting ||
			wf.Status == models.WorkForceStatusPlanning ||
			wf.Status == models.WorkForceStatusAwaitingApproval ||
			wf.Status == models.WorkForceStatusHalted ||
			wf.Status == models.WorkForceStatusFailed {
			continue
		}

		// Skip if there is already an active goroutine for THIS workforce
		var wfActive bool
		o.activeExecs.Range(func(_, v any) bool {
			execCtx, ok := v.(*executionContext)
			if ok && execCtx.workforceID == wf.ID {
				wfActive = true
				return false
			}
			return true
		})
		if wfActive {
			continue
		}

		// Enforce the heartbeat interval: only proceed if enough time has elapsed
		// since the last execution for this workforce.
		lastExec, err := o.store.GetLatestExecution(ctx, wf.ID)
		if err != nil {
			log.Printf("scheduler: latest execution for %q: %v", wf.Name, err)
			continue
		}
		if lastExec != nil {
			interval := time.Duration(wf.HeartbeatIntervalM) * time.Minute
			referenceTime := lastExec.CreatedAt
			if lastExec.EndedAt != nil {
				referenceTime = *lastExec.EndedAt
			}
			if time.Since(referenceTime) < interval {
				continue // too soon
			}
		}

		// Prefer kanban todo tasks over the workforce's generic objective.
		// This is the core of the autonomous kanban loop: pick the highest-priority
		// todo task, launch an execution from it, and link them.
		nextTask, err := o.store.GetNextTodoKanbanTask(ctx, wf.ID)
		if err != nil {
			log.Printf("scheduler: get next todo task for %q: %v", wf.Name, err)
			continue
		}

		if nextTask != nil {
			objective := nextTask.Title
			if nextTask.Description != "" {
				objective = nextTask.Title + "\n\n" + nextTask.Description
			}

			// Inject attached workspace files into the objective.
			if len(nextTask.Attachments) > 0 {
				wsRoot := workspace.WorkspacePath(wf.Name)
				objective += "\n\n## Attached Files\n"
				for _, relPath := range nextTask.Attachments {
					absPath := filepath.Join(wsRoot, filepath.Clean(relPath))
					data, readErr := os.ReadFile(absPath)
					if readErr != nil {
						objective += fmt.Sprintf("\n### /workspace/%s\n[file not found]\n", relPath)
						continue
					}
					objective += fmt.Sprintf("\n### /workspace/%s\n```\n%s\n```\n", relPath, string(data))
				}
			}

			// Inject referenced task context.
			if len(nextTask.TaskRefs) > 0 {
				objective += "\n\n## Referenced Tasks\n"
				for _, refIDStr := range nextTask.TaskRefs {
					refID, parseErr := uuid.Parse(refIDStr)
					if parseErr != nil {
						continue
					}
					ref, refErr := o.store.GetKanbanTask(ctx, refID)
					if refErr != nil {
						continue
					}
					objective += fmt.Sprintf("\n### %s\n**Description:** %s\n", ref.Title, ref.Description)
					if ref.ExecutionID != nil {
						exec, execErr := o.store.GetExecution(ctx, *ref.ExecutionID)
						if execErr == nil && exec.Result != "" {
							result := exec.Result
							if len(result) > 2000 {
								result = result[:2000] + "\n…[truncated]"
							}
							objective += fmt.Sprintf("**Result:** %s\n", result)
						}
					}
				}
			}

			log.Printf("scheduler: launching kanban task %q for workforce %q", nextTask.Title, wf.Name)
			exec, err := o.StartExecution(ctx, wf.ID, objective, nil)
			if err != nil {
				log.Printf("scheduler: start execution for task %q: %v", nextTask.Title, err)
				continue
			}
			// Link task to execution and move to in_progress
			execIDStr := exec.ID.String()
			inProgress := models.KanbanStatusInProgress
			if _, err := o.store.UpdateKanbanTask(ctx, nextTask.ID, models.UpdateKanbanTaskRequest{
				Status:      &inProgress,
				ExecutionID: &execIDStr,
			}); err != nil {
				log.Printf("scheduler: link kanban task %s: %v", nextTask.ID, err)
			}
		} else {
			if !autonomousObjectiveFallbackEnabled {
				log.Printf("scheduler: no todo kanban task for %q; skipping objective fallback (ORCH_AUTONOMOUS_OBJECTIVE_FALLBACK=false)", wf.Name)
				continue
			}
			// No todo tasks — fall back to the workforce's configured objective
			log.Printf("scheduler: no kanban tasks, launching objective execution for %q", wf.Name)
			if _, err := o.StartExecution(ctx, wf.ID, wf.Objective, nil); err != nil {
				log.Printf("scheduler: start execution for %q: %v", wf.Name, err)
			}
		}
	}

	// Check and refresh stale project briefs
	o.runBriefSchedulerTick(ctx)
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

// appendInterventionMessage preserves all operator interventions that arrive in
// quick succession and injects them together in the next agent round.
func appendInterventionMessage(existing, msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return existing
	}
	existing = strings.TrimSpace(existing)
	if existing == "" {
		return keepLastRunes(msg, maxInterventionContextChars)
	}
	combined := existing + "\n\n[Additional operator instruction]\n" + msg
	return keepLastRunes(combined, maxInterventionContextChars)
}

func keepLastRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	if max <= 2 {
		return string(r[len(r)-max:])
	}
	return "…\n" + string(r[len(r)-(max-2):])
}

func envInt(name string, fallback, minVal, maxVal int) int {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		log.Printf("orchestrator: invalid %s=%q (using default %d)", name, v, fallback)
		return fallback
	}
	if n < minVal || n > maxVal {
		log.Printf("orchestrator: out-of-range %s=%d (allowed %d..%d, using default %d)", name, n, minVal, maxVal, fallback)
		return fallback
	}
	return n
}

func envDuration(name string, fallback, minVal time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Printf("orchestrator: invalid %s=%q (using default %s)", name, v, fallback)
		return fallback
	}
	if d < minVal {
		log.Printf("orchestrator: too-small %s=%s (min %s, using default %s)", name, d, minVal, fallback)
		return fallback
	}
	return d
}

func envBool(name string, fallback bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	if v == "" {
		return fallback
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		log.Printf("orchestrator: invalid %s=%q (using default %t)", name, v, fallback)
		return fallback
	}
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

func (o *Orchestrator) resolveExecutionAgents(ctx context.Context, wf *models.WorkForce, exec *models.Execution) ([]*models.Agent, error) {
	agents, err := o.loadWorkForceAgents(ctx, wf)
	if err != nil {
		return nil, err
	}
	if len(agents) == 0 {
		return agents, nil
	}
	if executionModeFromInputs(exec.Inputs) != models.ExecutionModeSingleAgent {
		return agents, nil
	}

	if selected, ok := selectedExecutionAgentID(exec.Inputs); ok {
		for _, a := range agents {
			if a.ID == selected {
				return []*models.Agent{a}, nil
			}
		}
	}

	if wf.LeaderAgentID != nil {
		for _, a := range agents {
			if a.ID == *wf.LeaderAgentID {
				return []*models.Agent{a}, nil
			}
		}
	}

	return []*models.Agent{agents[0]}, nil
}

func buildExecutionInputs(inputs map[string]string, mode models.ExecutionMode, agentID *uuid.UUID) map[string]string {
	out := make(map[string]string, len(inputs)+2)
	for k, v := range inputs {
		out[k] = v
	}

	resolvedMode := normalizeExecutionMode(mode)
	out[executionModeInputKey] = string(resolvedMode)
	if resolvedMode == models.ExecutionModeSingleAgent && agentID != nil {
		out[executionAgentIDInputKey] = agentID.String()
	}

	return out
}

func normalizeExecutionMode(mode models.ExecutionMode) models.ExecutionMode {
	mode = models.ExecutionMode(strings.TrimSpace(strings.ToLower(string(mode))))
	switch mode {
	case "", models.ExecutionModeAllAgents:
		return models.ExecutionModeAllAgents
	case models.ExecutionModeSingleAgent:
		return models.ExecutionModeSingleAgent
	default:
		return models.ExecutionModeAllAgents
	}
}

func executionModeFromInputs(inputs map[string]string) models.ExecutionMode {
	if inputs == nil {
		return models.ExecutionModeAllAgents
	}
	return normalizeExecutionMode(models.ExecutionMode(inputs[executionModeInputKey]))
}

func selectedExecutionAgentID(inputs map[string]string) (uuid.UUID, bool) {
	if inputs == nil {
		return uuid.Nil, false
	}
	raw := strings.TrimSpace(inputs[executionAgentIDInputKey])
	if raw == "" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func shouldAutoRunWithoutApproval(exec *models.Execution, wf *models.WorkForce) bool {
	if exec == nil {
		return false
	}
	if wf != nil && wf.AutonomousMode {
		return true
	}
	return executionModeFromInputs(exec.Inputs) == models.ExecutionModeSingleAgent
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

	// Build and persist the delivery report from tool call events.
	go func() {
		bgCtx := context.Background()
		if wf, err := o.store.GetWorkForce(bgCtx, wfID); err == nil {
			events, err := o.store.ListExecutionEvents(bgCtx, execID)
			if err == nil {
				wsPath := workspace.WorkspacePath(wf.Name)
				report := buildDeliveryReport(events, wsPath)
				if len(report.Files) > 0 || len(report.Actions) > 0 {
					if err := o.store.SaveDeliveryReport(bgCtx, execID, report); err != nil {
						log.Printf("orchestrator: save delivery report for %s: %v", execID, err)
					}
				}
			}
		}
	}()
	o.store.UpdateWorkForceStatus(ctx, wfID, models.WorkForceStatusCompleted)

	// Enrich activity metadata with human-readable names and title
	var wfName, execTitle string
	var execModel *models.Execution
	if wf, err := o.store.GetWorkForce(ctx, wfID); err == nil {
		wfName = wf.Name
	}
	if exec, err := o.store.GetExecution(ctx, execID); err == nil {
		execModel = exec
		if exec.Title != "" {
			execTitle = exec.Title
		}
	}
	// If this execution was linked to a kanban task, mark it done and run QA review.
	if task, _ := o.store.FindKanbanTaskByExecutionID(ctx, execID); task != nil {
		done := models.KanbanStatusDone
		updateReq := models.UpdateKanbanTaskRequest{Status: &done}
		completionNote := buildKanbanCompletionKnowledgeEntry(
			result,
			o.knowledgeManager != nil,
			execModel != nil && execModel.ProjectID != nil && *execModel.ProjectID != uuid.Nil,
		)
		if completionNote != "" {
			notes := completionNote
			if strings.TrimSpace(task.Notes) != "" {
				notes = task.Notes + "\n" + completionNote
			}
			updateReq.Notes = &notes
		}
		if updatedTask, err := o.store.UpdateKanbanTask(ctx, task.ID, updateReq); err != nil {
			log.Printf("kanban: failed to update task %s after execution completion: %v", task.ID, err)
		} else if updatedTask != nil {
			task = updatedTask
		}
		// QA runs in background — don't block the completion flow
		go o.evaluateKanbanTaskCompletion(context.Background(), task, result, wfID)
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
			// Extract and store structured lessons from this execution
			go o.extractAndIngestLessons(context.Background(), wfID, execID, exec.Objective, result)
			// Extract project-scoped facts if this execution belongs to a project
			if exec.ProjectID != nil && *exec.ProjectID != uuid.Nil {
				go o.extractAndIngestProjectFacts(context.Background(), wfID, execID, *exec.ProjectID, exec.Objective, result, msgs)
			}
		}()
	}

	// Refresh project brief if this execution was part of a project and auto-refresh is enabled
	go func() {
		exec, err := o.store.GetExecution(context.Background(), execID)
		if err != nil || exec.ProjectID == nil || *exec.ProjectID == uuid.Nil {
			return
		}
		proj, err := o.store.GetProject(context.Background(), *exec.ProjectID)
		if err != nil || proj.BriefIntervalM == 0 {
			return
		}
		o.enqueueProjectBriefRefresh(*exec.ProjectID, "post_execution")
	}()
}

func buildKanbanCompletionKnowledgeEntry(result string, includeKnowledge bool, includeProjectFacts bool) string {
	summary := summarizeExecutionResultForKanban(result)
	if summary == "" {
		summary = "Task completed successfully."
	}

	parts := []string{fmt.Sprintf("[%s] ✓ done: %s", time.Now().Format("2006-01-02 15:04"), summary)}

	if artifacts := extractWorkspaceArtifacts(result, 4); len(artifacts) > 0 {
		parts = append(parts, fmt.Sprintf("artifacts: %s", strings.Join(artifacts, ", ")))
	}

	if includeKnowledge {
		ragSources := []string{"execution_result", "agent_messages", "lessons"}
		if includeProjectFacts {
			ragSources = append(ragSources, "project_facts")
		}
		parts = append(parts, fmt.Sprintf("knowledge saved for RAG: %s", strings.Join(ragSources, ", ")))
	}

	return strings.Join(parts, " | ")
}

func summarizeExecutionResultForKanban(result string) string {
	for _, rawLine := range strings.Split(result, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "```") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			if idx := strings.Index(line, "]:"); idx > 0 && idx+2 < len(line) {
				line = strings.TrimSpace(line[idx+2:])
			}
		}
		line = strings.TrimSpace(strings.TrimLeft(line, "#*- "))
		if line == "" || strings.HasPrefix(line, "{") {
			continue
		}
		return truncateStr(line, 280)
	}
	return ""
}

func extractWorkspaceArtifacts(text string, maxCount int) []string {
	if maxCount <= 0 {
		return nil
	}

	matches := workspaceArtifactPathPattern.FindAllString(text, -1)
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(matches))
	artifacts := make([]string, 0, len(matches))
	for _, match := range matches {
		if _, ok := seen[match]; ok {
			continue
		}
		seen[match] = struct{}{}
		artifacts = append(artifacts, match)
		if len(artifacts) >= maxCount {
			break
		}
	}

	return artifacts
}

// extractAndIngestLessons runs a lightweight LLM call to distill reusable lessons AND
// step-by-step procedures from a completed execution. Procedures are synthesized from
// the actual tool call sequence (API endpoints, credential key names, request format)
// so agents never re-discover the same API flow from scratch.
// Runs in a background goroutine — failures are logged but never surface to the user.
func (o *Orchestrator) extractAndIngestLessons(ctx context.Context, wfID, execID uuid.UUID, objective, result string) {
	if o.knowledgeManager == nil {
		return
	}

	// Find any available LLM connector (skip media/image agents)
	wf, err := o.store.GetWorkForce(ctx, wfID)
	if err != nil {
		return
	}
	agents, err := o.loadWorkForceAgents(ctx, wf)
	if err != nil || len(agents) == 0 {
		return
	}
	var eng engine.Connector
	var modelName string
	for _, a := range agents {
		if a.ModelType != "" && a.ModelType != string(models.ModelTypeLLM) {
			continue
		}
		if e, m, err := o.resolveConnector(ctx, a); err == nil {
			eng, modelName = e, m
			break
		}
	}
	if eng == nil {
		return
	}

	// Build a sanitized summary of the tool call sequence from the events log.
	// This is the key data the LLM needs to synthesize reusable procedures.
	toolSummary := ""
	if events, evErr := o.store.ListExecutionEvents(ctx, execID); evErr == nil {
		toolSummary = buildSanitizedToolCallSummary(events)
	}

	truncResult := result
	if len(truncResult) > 1500 {
		truncResult = truncResult[:1500] + "\n…[truncated]"
	}

	toolSection := ""
	if toolSummary != "" {
		toolSection = "\n\nTOOL CALL SEQUENCE (sanitized — credentials replaced with <secret:service/key>):\n" + toolSummary
	}

	prompt := fmt.Sprintf(
		"You are extracting reusable knowledge from a completed AI agent execution.\n\n"+
			"OBJECTIVE: %s\n\n"+
			"RESULT SUMMARY:\n%s%s\n\n"+
			"Extract two types of knowledge:\n\n"+
			"1. LESSONS (3-5): Concrete facts, patterns that worked, pitfalls to avoid. "+
			"Skip generic advice. Focus on: what the agent discovered, what failed and why, tool-specific quirks.\n\n"+
			"2. PROCEDURES (0-3): For any successful API call sequences, external service integrations, or "+
			"repeatable tool patterns in the tool call sequence above — write a step-by-step procedure "+
			"that another agent can follow exactly next time. Include: exact endpoints, which get_secret "+
			"keys to use (e.g. get_secret('service','key')), request body structure with placeholder values, "+
			"expected response fields to extract. Only write a procedure if the tool sequence shows a "+
			"repeatable pattern (e.g. auth + post, search + fetch, build + deploy).\n\n"+
			"Respond with ONLY this JSON (no markdown, no extra text):\n"+
			`{"lessons":[{"title":"short title ≤80 chars","content":"one or two concrete sentences"}],`+
			`"procedures":[{"title":"How to <verb> <service/thing>","content":"Step-by-step instructions"}]}`,
		objective, truncResult, toolSection,
	)

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentName:    "lesson-extractor",
		Model:        modelName,
		SystemPrompt: "You are a knowledge distillation assistant. Extract only concrete, actionable facts. For procedures, be precise about API endpoints, credential key names, and request formats. Respond only with the requested JSON.",
		Message:      prompt,
	})
	if err != nil {
		log.Printf("knowledge: lesson extraction LLM call failed for exec %s: %v", execID, err)
		return
	}

	// Parse JSON — be lenient about surrounding text/markdown
	raw := resp.Content
	if start := strings.Index(raw, "{"); start >= 0 {
		raw = raw[start:]
	}
	if end := strings.LastIndex(raw, "}"); end >= 0 {
		raw = raw[:end+1]
	}

	var parsed struct {
		Lessons []struct {
			Title   string `json:"title"`
			Content string `json:"content"`
		} `json:"lessons"`
		Procedures []struct {
			Title   string `json:"title"`
			Content string `json:"content"`
		} `json:"procedures"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		log.Printf("knowledge: lesson extraction parse failed for exec %s: %v (raw: %s)", execID, err, truncateStr(raw, 200))
		return
	}

	lessons := make([]knowledge.Lesson, 0, len(parsed.Lessons))
	for _, l := range parsed.Lessons {
		if l.Title != "" && l.Content != "" {
			lessons = append(lessons, knowledge.Lesson{Title: l.Title, Content: l.Content})
		}
	}
	procedures := make([]knowledge.Procedure, 0, len(parsed.Procedures))
	for _, p := range parsed.Procedures {
		if p.Title != "" && p.Content != "" {
			procedures = append(procedures, knowledge.Procedure{Title: p.Title, Content: p.Content})
		}
	}

	if len(lessons) > 0 {
		o.knowledgeManager.IngestLessons(ctx, wfID, execID, lessons)
		log.Printf("knowledge: ingested %d lessons for execution %s", len(lessons), execID)
	}
	if len(procedures) > 0 {
		o.knowledgeManager.IngestProcedures(ctx, wfID, execID, procedures)
		log.Printf("knowledge: ingested %d procedures for execution %s", len(procedures), execID)
	}
}

// buildSanitizedToolCallSummary produces a human-readable summary of the tool call
// sequence from an execution's events, suitable for the lesson extractor LLM.
// It redacts actual secret values returned by get_secret, replacing them with
// placeholder references so the procedure is safe to store.
func buildSanitizedToolCallSummary(events []*models.Event) string {
	// Track get_secret calls so we can annotate http_request bodies with credential references.
	var secretRefs []secretRef

	var lines []string
	var lastAgent string

	for _, ev := range events {
		if ev.Type != "tool_call" || ev.Data == nil {
			continue
		}
		tool, _ := ev.Data["tool"].(string)
		if tool == "" {
			continue
		}
		args, hasArgs := ev.Data["args"].(map[string]any)
		_, hasResult := ev.Data["result_length"]
		if hasResult {
			// Result event — skip (we already captured the call event)
			continue
		}
		if !hasArgs {
			continue
		}

		if lastAgent != ev.AgentName {
			lastAgent = ev.AgentName
			lines = append(lines, fmt.Sprintf("\nAgent: %s", ev.AgentName))
		}

		switch tool {
		case "get_secret":
			svc, _ := args["service"].(string)
			key, _ := args["key_name"].(string)
			if svc == "" {
				svc, _ = args["service_name"].(string)
			}
			secretRefs = append(secretRefs, secretRef{svc, key})
			lines = append(lines, fmt.Sprintf("  get_secret(service=%q, key=%q) → <secret:%s/%s>", svc, key, svc, key))

		case "http_request":
			method, _ := args["method"].(string)
			url, _ := args["url"].(string)
			body, _ := args["body"].(string)
			sanitized := sanitizeCredentialsFromBody(body, secretRefs)
			if len(sanitized) > 400 {
				sanitized = sanitized[:400] + "…"
			}
			lines = append(lines, fmt.Sprintf("  http_request(method=%s, url=%q, body=%s)", method, url, sanitized))

		case "run_command":
			cmd, _ := args["command"].(string)
			if len(cmd) > 200 {
				cmd = cmd[:200] + "…"
			}
			lines = append(lines, fmt.Sprintf("  run_command(%q)", cmd))

		case "write_file":
			path, _ := args["path"].(string)
			lines = append(lines, fmt.Sprintf("  write_file(path=%q)", path))

		case "list_secrets":
			lines = append(lines, "  list_secrets()")

		default:
			// Include tool name + first string arg for context
			for k, v := range args {
				if s, ok := v.(string); ok && len(s) > 0 && len(s) < 200 {
					lines = append(lines, fmt.Sprintf("  %s(%s=%q)", tool, k, s))
					break
				}
			}
			if len(lines) == 0 || lines[len(lines)-1] == fmt.Sprintf("\nAgent: %s", ev.AgentName) {
				lines = append(lines, fmt.Sprintf("  %s()", tool))
			}
		}
	}

	summary := strings.Join(lines, "\n")
	if len(summary) > 3000 {
		summary = summary[:3000] + "\n…[truncated]"
	}
	return summary
}

// sanitizeCredentialsFromBody replaces values that look like credentials in an HTTP request
// body string with safe placeholders. Handles both JSON string values and form-encoded
// values for common credential field names (password, token, key, secret, api_key).
// detectToolLoop inspects the recent tool call history and returns a corrective
// intervention message if the agent is stuck in a repetitive loop.
// Returns "" if no loop is detected. The returned message is injected into the
// conversation history as a user message before the next LLM call.
func detectToolLoop(calls []engine.ToolCallInfo) string {
	const window = 10
	if len(calls) < 4 {
		return ""
	}
	recent := calls
	if len(recent) > window {
		recent = recent[len(recent)-window:]
	}

	// Pattern 1: write_file ↔ run_command alternation (script-writing loop).
	// Triggers when the agent keeps writing scripts and running them iteratively.
	writeRunPairs := 0
	for i := 1; i < len(recent); i++ {
		a, b := recent[i-1].Name, recent[i].Name
		if (a == "write_file" && b == "run_command") ||
			(a == "run_command" && b == "write_file") {
			writeRunPairs++
		}
	}
	if writeRunPairs >= 3 {
		return "SYSTEM INTERVENTION: You are stuck in a script-writing loop — " +
			"you have been alternating between write_file and run_command multiple times without completing the task. " +
			"Stop writing scripts. If you need to call an HTTP API, use the http_request tool directly. " +
			"If you need to authenticate with a service, use get_secret to retrieve credentials and then " +
			"http_request to call the API endpoint. Do not write Python, shell, or any other scripts to accomplish API calls."
	}

	// Pattern 2: same tool called 4+ times in the recent window (discovery/exploration loop).
	// Triggers when an agent keeps listing directories, searching, or fetching the same resources.
	counts := map[string]int{}
	for _, tc := range recent {
		counts[tc.Name]++
	}
	skipTools := map[string]bool{"signal_complete": true, "signal_needs_help": true, "signal_blocked": true, "signal_ask_peer": true}
	for tool, count := range counts {
		if skipTools[tool] {
			continue
		}
		if count >= 4 {
			return fmt.Sprintf(
				"SYSTEM INTERVENTION: You have called '%s' %d times in recent rounds. "+
					"You appear stuck in a discovery loop. Stop repeating this tool. "+
					"Proceed with the information you already have, try a different approach, "+
					"or signal completion with what you've accomplished so far.", tool, count)
		}
	}

	return ""
}

type secretRef struct{ service, key string }

func sanitizeCredentialsFromBody(body string, refs []secretRef) string {
	if body == "" {
		return body
	}
	// Replace values associated with credential field names in JSON bodies.
	// Pattern: "fieldname": "value" → "fieldname": "<redacted>"
	credFields := []string{"password", "passwd", "token", "api_key", "apikey", "secret", "access_token", "refresh_token", "private_key"}
	result := body
	for _, field := range credFields {
		// Match JSON key-value: "field": "value" (handles spaces around colon)
		pattern := `"` + field + `"\s*:\s*"[^"]{4,}"`
		re := regexp.MustCompile(`(?i)` + pattern)
		result = re.ReplaceAllStringFunc(result, func(match string) string {
			// Keep the key, replace only the value
			colonIdx := strings.Index(match, ":")
			if colonIdx < 0 {
				return `"` + field + `": "<redacted>"`
			}
			return match[:colonIdx+1] + ` "<redacted>"`
		})
	}
	return result
}

// evaluateKanbanTaskCompletion runs a brief LLM review after an execution finishes
// to check whether the output actually satisfied the task's acceptance criteria.
// It updates qa_status and qa_notes on the task; if the LLM flags issues the task
// is also moved back to "blocked" so a human can review it.
func (o *Orchestrator) evaluateKanbanTaskCompletion(ctx context.Context, task *models.KanbanTask, executionResult string, wfID uuid.UUID) {
	// No criteria to evaluate against → skip
	if strings.TrimSpace(task.Description) == "" {
		skipped := models.KanbanQAStatusSkipped
		skippedNote := "QA skipped: no acceptance criteria in task description."
		o.store.UpdateKanbanTask(ctx, task.ID, models.UpdateKanbanTaskRequest{
			QAStatus: &skipped,
			QANotes:  &skippedNote,
		})
		return
	}

	// Pick a connector from any available agent in the workforce
	wf, err := o.store.GetWorkForce(ctx, wfID)
	if err != nil {
		return
	}
	wfAgents, err := o.loadWorkForceAgents(ctx, wf)
	if err != nil || len(wfAgents) == 0 {
		return
	}
	var eng engine.Connector
	for _, a := range wfAgents {
		// Skip image/video/audio agents — QA needs a text LLM
		if a.ModelType != "" && a.ModelType != string(models.ModelTypeLLM) {
			continue
		}
		if e, _, err := o.resolveConnector(ctx, a); err == nil {
			eng = e
			break
		}
	}
	if eng == nil {
		return
	}

	// Truncate result so we don't blow the context window
	truncResult := executionResult
	if len(truncResult) > 3000 {
		truncResult = truncResult[:3000] + "\n…[truncated]"
	}

	prompt := fmt.Sprintf(
		"You are a QA reviewer for an AI-generated task. Evaluate whether the execution output satisfies the task requirements.\n\n"+
			"TASK TITLE: %s\n\n"+
			"ACCEPTANCE CRITERIA / DESCRIPTION:\n%s\n\n"+
			"EXECUTION OUTPUT:\n%s\n\n"+
			"Respond ONLY with a JSON object in this exact format:\n"+
			`{"passed": true/false, "reason": "one or two sentences explaining your verdict"}`,
		task.Title, task.Description, truncResult,
	)

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentName:    "qa-reviewer",
		SystemPrompt: "You are a precise QA reviewer. Evaluate task completion objectively. Respond only with the requested JSON.",
		Message:      prompt,
	})
	if err != nil {
		log.Printf("kanban QA: llm call failed for task %s: %v", task.ID, err)
		return
	}

	// Parse the JSON verdict
	var verdict struct {
		Passed bool   `json:"passed"`
		Reason string `json:"reason"`
	}
	// Extract JSON from the response (may be wrapped in markdown)
	raw := resp.Content
	if start := strings.Index(raw, "{"); start != -1 {
		if end := strings.LastIndex(raw, "}"); end > start {
			json.Unmarshal([]byte(raw[start:end+1]), &verdict) //nolint:errcheck
		}
	}

	ts := fmt.Sprintf("[%s] QA", time.Now().Format("2006-01-02 15:04"))
	if verdict.Passed {
		passed := models.KanbanQAStatusPassed
		note := fmt.Sprintf("%s ✓ passed — %s", ts, verdict.Reason)
		o.store.UpdateKanbanTask(ctx, task.ID, models.UpdateKanbanTaskRequest{
			QAStatus: &passed,
			QANotes:  &note,
		})
		log.Printf("kanban QA: task %q passed (%s)", task.Title, verdict.Reason)
	} else {
		needsReview := models.KanbanQAStatusNeedsReview
		blocked := models.KanbanStatusBlocked
		note := fmt.Sprintf("%s ✗ needs review — %s", ts, verdict.Reason)
		o.store.UpdateKanbanTask(ctx, task.ID, models.UpdateKanbanTaskRequest{
			Status:   &blocked,
			QAStatus: &needsReview,
			QANotes:  &note,
		})
		log.Printf("kanban QA: task %q flagged for review (%s)", task.Title, verdict.Reason)
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

// firstNeedsHelpReason returns the first non-empty reason among needs_help subtasks.
func firstNeedsHelpReason(plan []models.ExecutionSubtask) string {
	for _, st := range plan {
		if st.Status != models.SubtaskNeedsHelp {
			continue
		}
		reason := strings.TrimSpace(st.ErrorMsg)
		if reason != "" {
			return reason
		}
	}
	return ""
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
			out := st.Output
			if len(out) > maxHandoffChars {
				out = out[:maxHandoffChars] + fmt.Sprintf("\n… (truncated, %d chars total)", len(st.Output))
			}
			parts = append(parts, fmt.Sprintf("### Output from %s\n%s", st.AgentName, out))
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
func (o *Orchestrator) runDiscussion(ctx context.Context, exec *models.Execution, wf *models.WorkForce, agents []*models.Agent, leaderAgent *models.Agent, planningBudget *planningBudgetTracker) ([]models.ExecutionSubtask, string) {
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
		if planningBudget.exhausted() {
			return buildSimplePlan(agents, exec.Objective), "Fallback plan (planning token budget exhausted)"
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

		// Media agents (image/video/audio generators) don't discuss — they only
		// execute when given a spec. Inject a static contribution and skip the LLM call.
		if engine.IsMediaConnector(eng) {
			staticContrib := fmt.Sprintf(
				"[%s]: I am a media generation agent. I do not participate in discussion. "+
					"Assign me a subtask with a JSON spec containing `prompt`, `output_path`, and optionally `aspect_ratio`. "+
					"I will generate the media and return the file path.\n"+
					"```json\n{\"status\": \"contribute\", \"primary_executor\": \"%s\", \"my_role\": \"Generate images/media on demand from structured specs.\"}\n```",
				agent.Name, agent.Name,
			)
			contributions = append(contributions, staticContrib)
			o.eventBus.Publish(ctx, models.NewEvent(exec.ID, &agentID, agent.Name,
				models.EventTypeDiscussionTurn,
				fmt.Sprintf("%s is a media generator — ready to receive image specs.", agent.Name), nil))
			turnCount++
			continue
		}

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
		o.consumePlanningTokens(ctx, exec.ID, planningBudget, resp, fmt.Sprintf("discussion contribution (%s)", agent.Name))
		if err != nil {
			log.Printf("orchestrator: discussion contribution from %s: %v", agent.Name, err)
			continue
		}
		if planningBudget.exhausted() {
			return buildSimplePlan(agents, exec.Objective), "Fallback plan (planning token budget exhausted)"
		}

		respMsg := &models.Message{
			ID: uuid.New(), ExecutionID: exec.ID, AgentID: &agentID, AgentName: agent.Name,
			Iteration: 0, Phase: models.MessagePhaseDiscussion, Role: models.MessageRoleAssistant,
			Content: resp.Content, TokensIn: resp.TokensIn, TokensOut: resp.TokensOut,
			Model: resp.Model, LatencyMs: resp.LatencyMs, CreatedAt: time.Now(),
		}
		o.store.CreateMessage(ctx, respMsg)

		contrib := resp.Content
		if len(contrib) > maxDiscussionContribChars {
			contrib = contrib[:maxDiscussionContribChars] + fmt.Sprintf("… (%d chars)", len(resp.Content))
		}
		contributions = append(contributions, fmt.Sprintf("[%s]: %s", agent.Name, contrib))

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
	if planningBudget.exhausted() {
		return buildSimplePlan(agents, exec.Objective), "Fallback plan (planning token budget exhausted)"
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
			"- If a media agent must produce multiple output files, create one subtask per output file and chain them with depends_on\n"+
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
	o.consumePlanningTokens(ctx, exec.ID, planningBudget, synthResp, "discussion synthesis")
	if err != nil {
		log.Printf("orchestrator: discussion: leader synthesis failed: %v", err)
		return buildSimplePlan(agents, exec.Objective), "Fallback plan (leader synthesis failed)"
	}
	if planningBudget.exhausted() {
		return buildSimplePlan(agents, exec.Objective), "Fallback plan (planning token budget exhausted)"
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
		Role:     models.MessageRoleAssistant,
		Content:  resp.Content,
		TokensIn: resp.TokensIn, TokensOut: resp.TokensOut,
		Model: resp.Model, LatencyMs: resp.LatencyMs, CreatedAt: time.Now(),
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
	wsManifest string,
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

	wsSection := ""
	if wsManifest != "" {
		wsSection = "\n\n" + wsManifest + "\n\n" +
			"**Important:** Files listed above were written to the team workspace during this execution. " +
			"A file that fulfils the objective counts as a completed deliverable even if the agent's text summary is sparse."
	}

	reviewPrompt := fmt.Sprintf(
		"## Post-Execution Quality Review\n\n"+
			"You are **%s**, the team leader. Your team has just completed the following objective:\n\n"+
			"**Objective:** %s\n\n"+
			"**Team outputs (one section per subtask):**\n%s%s\n\n"+
			"Review the combined output against the objective. Be lenient — partial completion, minor imperfections, "+
			"and rough formatting are acceptable. Only flag serious failures where the core objective was not addressed at all.\n\n"+
			"Respond with ONLY this JSON (no other text):\n"+
			`{"status":"review_passed","summary":"<2-3 sentences>","highlights":["<what was done well>"]}`+"\n\n"+
			"OR if there are critical gaps:\n"+
			`{"status":"review_needs_revision","summary":"<what was done>","issues":["<critical gap>"]}`,
		leaderAgent.Name, exec.Objective, outputsText, wsSection,
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
		Role:     models.MessageRoleAssistant,
		Content:  resp.Content,
		TokensIn: resp.TokensIn, TokensOut: resp.TokensOut,
		Model: resp.Model, LatencyMs: resp.LatencyMs, CreatedAt: time.Now(),
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
// ContinueExecution starts a new execution on the same workforce with the user's instruction
// and a compact summary of what the previous execution accomplished as context.
func (o *Orchestrator) ContinueExecution(ctx context.Context, prevExecID uuid.UUID, instruction string) (*models.Execution, error) {
	prevExec, err := o.store.GetExecution(ctx, prevExecID)
	if err != nil {
		return nil, fmt.Errorf("previous execution not found: %w", err)
	}

	contextNote := fmt.Sprintf("Previous objective: %s", prevExec.Objective)
	if prevExec.Result != "" {
		result := prevExec.Result
		if len(result) > 800 {
			result = result[:800] + "…"
		}
		contextNote += "\nPrevious outcome: " + result
	}

	objective := instruction + "\n\n[Continuing from execution " + prevExecID.String()[:8] + "]\n" + contextNote
	return o.StartExecution(ctx, prevExec.WorkForceID, objective, nil)
}

// ResumeWithInstruction resumes a halted execution and injects the operator's instruction
// as an intervention message that agents will see on the next iteration.
func (o *Orchestrator) ResumeWithInstruction(ctx context.Context, execID uuid.UUID, instruction string) error {
	// Store the instruction as a message so agents see it after resume
	msg := &models.Message{
		ID:          uuid.New(),
		ExecutionID: execID,
		Iteration:   0,
		Role:        models.MessageRoleUser,
		AgentName:   "operator",
		Content:     "[Operator instruction]: " + instruction,
		CreatedAt:   time.Now(),
	}
	o.store.CreateMessage(ctx, msg)
	return o.ResumeExecution(ctx, execID)
}

func (o *Orchestrator) AnswerQuestion(ctx context.Context, execID uuid.UUID, question string, history []engine.ChatMessage) (string, error) {
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

	systemPrompt := "You are an intelligent assistant with full context of an AI agent execution. " +
		"Answer questions concisely and factually based on the execution transcript. " +
		"If asked about files, outputs, or results, be specific about what agents produced. " +
		"If the answer cannot be determined from the transcript, say so clearly."

	// Build the context message (only sent once, as the first user turn)
	contextMsg := fmt.Sprintf(
		"## Execution Context\n**ID:** %s\n**Status:** %s\n**Objective:** %s\n\n## Agent Transcript\n\n%s",
		execID, exec.Status, exec.Objective, transcript,
	)

	// Build full history: context first, then prior conversation, then current question
	fullHistory := []engine.ChatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: contextMsg},
		{Role: "assistant", Content: "Understood. I have reviewed the execution context and agent transcript. What would you like to know?"},
	}
	fullHistory = append(fullHistory, history...)
	fullHistory = append(fullHistory, engine.ChatMessage{Role: "user", Content: question})

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
		AgentName: "qa-analyst",
		Model:     modelName,
		History:   fullHistory,
	})
	if err != nil {
		return "", fmt.Errorf("llm call: %w", err)
	}
	return resp.Content, nil
}

// buildWorkspaceSnapshot returns a shallow directory listing of the workspace
// formatted for injection into the agent's task message. Returns "" on error or
// empty workspace so callers can skip the section gracefully.
func buildWorkspaceSnapshot(workspacePath string) string {
	entries, err := os.ReadDir(workspacePath)
	if err != nil || len(entries) == 0 {
		return ""
	}
	var lines []string
	for _, e := range entries {
		if e.IsDir() {
			lines = append(lines, "  "+e.Name()+"/")
		} else {
			info, _ := e.Info()
			size := ""
			if info != nil {
				lines = append(lines, fmt.Sprintf("  %s (%s)", e.Name(), humanSize(info.Size())))
			} else {
				lines = append(lines, "  "+e.Name()+size)
			}
		}
	}
	return strings.Join(lines, "\n")
}

// buildSecretsSnapshot lists stored credential handles (service + key name, no values)
// so agents know which secrets are available without having to call list_secrets().
func buildSecretsSnapshot(ctx context.Context, s *store.Store, wfID uuid.UUID) string {
	creds, err := s.ListCredentials(ctx, wfID)
	if err != nil || len(creds) == 0 {
		return "No credentials stored yet."
	}
	var lines []string
	for _, c := range creds {
		lines = append(lines, fmt.Sprintf("- get_secret(%q, %q)", c.Service, c.KeyName))
	}
	return strings.Join(lines, "\n")
}

// humanSize formats a byte count as a human-readable string (B / KB / MB / GB).
func humanSize(b int64) string {
	switch {
	case b < 1024:
		return fmt.Sprintf("%d B", b)
	case b < 1024*1024:
		return fmt.Sprintf("%.1f KB", float64(b)/1024)
	case b < 1024*1024*1024:
		return fmt.Sprintf("%.1f MB", float64(b)/(1024*1024))
	default:
		return fmt.Sprintf("%.2f GB", float64(b)/(1024*1024*1024))
	}
}

// ── Delivery report ───────────────────────────────────────────────────────────

// buildDeliveryReport scans execution events and synthesises a structured
// summary of files written and external actions performed.
func buildDeliveryReport(events []*models.Event, workspacePath string) models.DeliveryReport {
	filesSeen := map[string]*models.DeliveryFile{} // workspace-relative path → entry
	actionsSeen := map[string]bool{}               // dedup key → seen
	var actions []models.DeliveryAction

	for _, ev := range events {
		if ev.Type != models.EventTypeToolCall {
			continue
		}
		// Only process events that carry tool args (the "calling tool" events).
		rawArgs, ok := ev.Data["args"]
		if !ok || rawArgs == nil {
			continue
		}
		args, ok := rawArgs.(map[string]any)
		if !ok {
			continue
		}
		tool, _ := ev.Data["tool"].(string)

		switch tool {
		case "write_file", "append_to_file":
			rawPath, _ := args["path"].(string)
			if rawPath == "" {
				continue
			}
			relPath := normalizeToWorkspaceRelative(rawPath, workspacePath)
			if relPath == "" {
				continue
			}
			ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(relPath), "."))
			filesSeen[relPath] = &models.DeliveryFile{Path: relPath, Ext: ext}

		case "http_request":
			rawURL, _ := args["url"].(string)
			method, _ := args["method"].(string)
			method = strings.ToUpper(strings.TrimSpace(method))
			if rawURL == "" || method == "" || method == "GET" || method == "HEAD" || method == "OPTIONS" {
				continue
			}
			service := detectExternalService(rawURL)
			if service == "" {
				continue
			}
			desc := describeHTTPAction(method, service, rawURL)
			key := method + "\x00" + rawURL
			if !actionsSeen[key] {
				actionsSeen[key] = true
				actions = append(actions, models.DeliveryAction{
					Service:     service,
					Description: desc,
					Method:      method,
					URL:         sanitizeURL(rawURL),
				})
			}

		case "run_command":
			cmd, _ := args["command"].(string)
			desc, service := parseCommandAction(cmd)
			if desc == "" {
				continue
			}
			key := cmd
			if !actionsSeen[key] {
				actionsSeen[key] = true
				actions = append(actions, models.DeliveryAction{
					Service:     service,
					Description: desc,
				})
			}
		}
	}

	// Enrich file entries with current on-disk sizes.
	var files []models.DeliveryFile
	for relPath, f := range filesSeen {
		absPath := filepath.Join(workspacePath, relPath)
		if info, err := os.Stat(absPath); err == nil {
			f.SizeBytes = info.Size()
		}
		files = append(files, *f)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })

	return models.DeliveryReport{Files: files, Actions: actions}
}

// normalizeToWorkspaceRelative converts any form of workspace path to a
// workspace-relative path suitable for frontend rendering via WorkspaceFilePath.
func normalizeToWorkspaceRelative(rawPath, workspacePath string) string {
	p := rawPath
	// Virtual /workspace/ alias
	if p == "/workspace" || p == "/workspace/" {
		return ""
	}
	if strings.HasPrefix(p, "/workspace/") {
		p = strings.TrimPrefix(p, "/workspace/")
	} else if strings.HasPrefix(p, workspacePath+"/") {
		p = strings.TrimPrefix(p, workspacePath+"/")
	} else if filepath.IsAbs(p) {
		// Absolute but outside workspace — skip
		return ""
	}
	p = strings.TrimPrefix(p, "./")
	return p
}

// detectExternalService returns a human-readable service name for a URL, or ""
// if the URL doesn't match any known external service.
func detectExternalService(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	switch {
	case strings.Contains(host, "bsky.") || strings.Contains(host, "bluesky."):
		return "Bluesky"
	case strings.Contains(host, "dev.to") || strings.Contains(host, "forem."):
		return "Dev.to"
	case strings.Contains(host, "github.com") || strings.Contains(host, "api.github."):
		return "GitHub"
	case strings.Contains(host, "youtube.") || strings.Contains(host, "youtu.be"):
		return "YouTube"
	case strings.Contains(host, "twitter.com") || strings.Contains(host, "api.twitter.") || host == "x.com" || strings.HasSuffix(host, ".x.com"):
		return "X/Twitter"
	case strings.Contains(host, "graph.facebook.") || strings.Contains(host, "facebook.com"):
		return "Facebook"
	case strings.Contains(host, "instagram."):
		return "Instagram"
	case strings.Contains(host, "linkedin."):
		return "LinkedIn"
	case strings.Contains(host, "discord."):
		return "Discord"
	case strings.Contains(host, "slack."):
		return "Slack"
	case strings.Contains(host, "notion."):
		return "Notion"
	case strings.Contains(host, "airtable."):
		return "Airtable"
	case strings.Contains(host, "stripe."):
		return "Stripe"
	case strings.Contains(host, "sendgrid."):
		return "SendGrid"
	case strings.Contains(host, "mailgun."):
		return "Mailgun"
	case strings.Contains(host, "twilio."):
		return "Twilio"
	case strings.Contains(host, "openai."):
		return "OpenAI"
	case strings.Contains(host, "anthropic."):
		return "Anthropic"
	case strings.Contains(host, "reddit."):
		return "Reddit"
	case strings.Contains(host, "medium."):
		return "Medium"
	case strings.Contains(host, "hashnode."):
		return "Hashnode"
	case strings.Contains(host, "substack."):
		return "Substack"
	case strings.Contains(host, "wordpress."):
		return "WordPress"
	case strings.Contains(host, "hubspot."):
		return "HubSpot"
	case strings.Contains(host, "telegram."):
		return "Telegram"
	case strings.Contains(host, "api.resend."):
		return "Resend"
	default:
		return ""
	}
}

// describeHTTPAction returns a human-readable description of an HTTP action.
func describeHTTPAction(method, service, rawURL string) string {
	u, _ := url.Parse(rawURL)
	path := ""
	if u != nil {
		path = strings.ToLower(u.Path)
	}
	switch method {
	case "POST":
		switch service {
		case "Bluesky":
			return "Published post on Bluesky"
		case "Dev.to":
			return "Published article on Dev.to"
		case "GitHub":
			switch {
			case strings.Contains(path, "/releases"):
				return "Created GitHub release"
			case strings.Contains(path, "/issues"):
				return "Created GitHub issue"
			case strings.Contains(path, "/pulls"):
				return "Created GitHub pull request"
			case strings.Contains(path, "/comments"):
				return "Posted GitHub comment"
			default:
				return "GitHub API call"
			}
		case "Discord":
			return "Sent message to Discord"
		case "Slack":
			return "Sent message to Slack"
		case "Telegram":
			return "Sent message to Telegram"
		case "Reddit":
			return "Submitted post to Reddit"
		case "Medium":
			return "Published post on Medium"
		case "Hashnode":
			return "Published post on Hashnode"
		case "Substack":
			return "Published post on Substack"
		case "WordPress":
			return "Published post on WordPress"
		case "SendGrid", "Resend", "Mailgun":
			return fmt.Sprintf("Sent email via %s", service)
		default:
			return fmt.Sprintf("POST to %s", service)
		}
	case "PUT", "PATCH":
		return fmt.Sprintf("Updated content on %s", service)
	case "DELETE":
		return fmt.Sprintf("Deleted from %s", service)
	default:
		return fmt.Sprintf("%s %s", method, service)
	}
}

// parseCommandAction returns a human-readable description and service name for
// a shell command that represents a meaningful external action. Returns ("", "")
// if the command is not a recognised action (reads/local-only operations are skipped).
func parseCommandAction(cmd string) (description, service string) {
	lower := strings.ToLower(strings.TrimSpace(cmd))
	switch {
	case strings.Contains(lower, "git push"):
		return "Pushed commits to repository", "Git"
	case strings.Contains(lower, "git commit"):
		return "Committed changes to Git", "Git"
	case strings.Contains(lower, "npm publish"):
		return "Published npm package", "npm"
	case strings.Contains(lower, "cargo publish"):
		return "Published Rust crate", "Cargo"
	case strings.Contains(lower, "docker push"):
		return "Pushed Docker image", "Docker"
	case strings.Contains(lower, "twine upload") || strings.Contains(lower, "pip publish"):
		return "Published Python package", "PyPI"
	case strings.Contains(lower, "gh release create"):
		return "Created GitHub release via CLI", "GitHub"
	case strings.Contains(lower, "gh pr create"):
		return "Created GitHub pull request via CLI", "GitHub"
	case strings.Contains(lower, "gh issue create"):
		return "Created GitHub issue via CLI", "GitHub"
	default:
		return "", ""
	}
}

// sanitizeURL strips query parameters that may contain tokens/secrets.
func sanitizeURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	// Strip any query params — they commonly carry API keys
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}
