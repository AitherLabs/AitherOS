package orchestrator

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

// RefreshProjectBrief regenerates the project brief using the workforce leader agent.
// Synthesizes recent executions + kanban state into an updated living document.
// Returns an error so it can be used both synchronously (API handler) and in goroutines.
func (o *Orchestrator) RefreshProjectBrief(ctx context.Context, projectID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	proj, err := o.store.GetProject(ctx, projectID)
	if err != nil {
		return fmt.Errorf("brief: get project: %w", err)
	}

	wf, err := o.store.GetWorkForce(ctx, proj.WorkforceID)
	if err != nil {
		return fmt.Errorf("brief: get workforce: %w", err)
	}

	agents, err := o.loadWorkForceAgents(ctx, wf)
	if err != nil || len(agents) == 0 {
		return fmt.Errorf("brief: load agents: %w", err)
	}

	eng, modelName := o.resolveTextEngine(ctx, wf, agents)
	if eng == nil {
		return fmt.Errorf("brief: no text engine available for workforce %s", wf.Name)
	}

	// Recent executions for this project (last 15)
	execs, err := o.store.ListExecutionsByProject(ctx, projectID, 15)
	if err != nil {
		log.Printf("brief: list executions for %s: %v", proj.Name, err)
		execs = nil
	}

	// Kanban tasks belonging to this project
	allTasks, err := o.store.ListKanbanTasks(ctx, wf.ID)
	if err != nil {
		log.Printf("brief: list kanban tasks for %s: %v", proj.Name, err)
		allTasks = nil
	}
	var projectTasks []*models.KanbanTask
	for _, t := range allTasks {
		if t.ProjectID != nil && *t.ProjectID == projectID {
			projectTasks = append(projectTasks, t)
		}
	}

	prompt := buildBriefRefreshPrompt(proj, wf.Name, execs, projectTasks)

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentName:    "brief-updater",
		SystemPrompt: "You are a technical project manager maintaining a living project brief. Output only the updated brief in markdown. No preamble, no explanation, no code fences.",
		Message:      prompt,
		Model:        modelName,
	})
	if err != nil {
		return fmt.Errorf("brief: LLM call: %w", err)
	}
	if resp == nil || strings.TrimSpace(resp.Content) == "" {
		return fmt.Errorf("brief: empty LLM response")
	}

	newBrief := strings.TrimSpace(resp.Content)
	// Strip code fences if the model wrapped output anyway
	for _, fence := range []string{"```markdown\n", "```\n"} {
		if strings.HasPrefix(newBrief, fence) {
			newBrief = strings.TrimPrefix(newBrief, fence)
			newBrief = strings.TrimSuffix(newBrief, "```")
			newBrief = strings.TrimSpace(newBrief)
			break
		}
	}

	if err := o.store.UpdateProjectBrief(ctx, projectID, newBrief); err != nil {
		return fmt.Errorf("brief: save: %w", err)
	}

	log.Printf("brief: updated for project %q (%s) — %d chars", proj.Name, projectID, len(newBrief))
	return nil
}

// resolveTextEngine finds the best non-media LLM connector for a workforce.
// Tries the leader agent first, then the rest of the team.
func (o *Orchestrator) resolveTextEngine(ctx context.Context, wf *models.WorkForce, agents []*models.Agent) (engine.Connector, string) {
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
		if err == nil && !engine.IsMediaConnector(e) {
			return e, m
		}
	}
	return nil, ""
}

// runBriefSchedulerTick finds projects with stale briefs (brief_interval_m > 0) and refreshes them.
func (o *Orchestrator) runBriefSchedulerTick(ctx context.Context) {
	projects, err := o.store.ListProjectsWithStaleBriefs(ctx)
	if err != nil {
		log.Printf("brief-scheduler: list stale briefs: %v", err)
		return
	}
	for _, proj := range projects {
		projID := proj.ID
		log.Printf("brief-scheduler: refreshing brief for project %q", proj.Name)
		go func() {
			if err := o.RefreshProjectBrief(context.Background(), projID); err != nil {
				log.Printf("brief-scheduler: refresh %s: %v", projID, err)
			}
		}()
	}
}

func buildBriefRefreshPrompt(proj *models.Project, workforceName string, execs []*models.Execution, tasks []*models.KanbanTask) string {
	currentBrief := proj.Brief
	if currentBrief == "" {
		currentBrief = "(no brief yet — create it from scratch based on the available context)"
	}

	// Execution summary
	var execLines []string
	for _, e := range execs {
		title := e.Title
		if title == "" {
			title = truncateStr(e.Objective, 70)
		}
		line := fmt.Sprintf("- [%s] %s (%s)", e.CreatedAt.Format("2006-01-02"), title, e.Status)
		execLines = append(execLines, line)
		if e.Result != "" {
			result := e.Result
			if len(result) > 300 {
				result = result[:300] + "…"
			}
			execLines = append(execLines, fmt.Sprintf("  ↳ %s", result))
		}
	}
	execSummary := strings.Join(execLines, "\n")
	if execSummary == "" {
		execSummary = "(no executions yet)"
	}

	// Task summary grouped by status
	byStatus := map[string][]string{}
	statusOrder := []string{"in_progress", "todo", "blocked", "open", "done"}
	for _, t := range tasks {
		byStatus[string(t.Status)] = append(byStatus[string(t.Status)], t.Title)
	}
	var taskLines []string
	for _, s := range statusOrder {
		titles := byStatus[s]
		if len(titles) == 0 {
			continue
		}
		taskLines = append(taskLines, fmt.Sprintf("**%s** (%d):", s, len(titles)))
		for _, t := range titles {
			taskLines = append(taskLines, fmt.Sprintf("  - %s", t))
		}
	}
	taskSummary := strings.Join(taskLines, "\n")
	if taskSummary == "" {
		taskSummary = "(no tasks)"
	}

	return fmt.Sprintf(`You are updating the project brief for "%s" (workforce: %s).

Project description:
%s

Current brief:
%s

Recent executions (newest first):
%s

Current kanban tasks:
%s

Produce an updated, comprehensive project brief. Use these sections (include only what's relevant — omit empty sections):

# Project: %s

## Objective
[Clear statement of what this project accomplishes and its goals. Preserve the user's original intent.]

## Workspace
[Key file paths, directories, repos actively used. Be specific with absolute paths.]

## Current State
[What is built, deployed, or running right now.]

## Accomplished
[Summary of completed work. What was done, not how.]

## Tools & Services
[APIs, MCP tools, credentials, external services that are configured and working. Include which service names, endpoints, or credential keys to use.]

## What Works
[Proven approaches, patterns, exact commands, naming conventions. The more specific the better — this is the most token-saving section.]

## Avoid
[Failed approaches, non-existent paths, rate limits, deprecated APIs, things that have wasted time. Be blunt and specific.]

## Pending
[Remaining tasks and known work items. Mirror the kanban where relevant.]

Output ONLY the updated brief in markdown. No preamble, no explanation.`,
		proj.Name, workforceName,
		proj.Description,
		currentBrief,
		execSummary,
		taskSummary,
		proj.Name,
	)
}
