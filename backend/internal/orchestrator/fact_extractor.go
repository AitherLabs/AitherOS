package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/knowledge"
	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

// extractAndIngestProjectFacts runs an LLM call to extract concrete, project-scoped facts
// from a completed execution, then stores them as KnowledgeSourceFact entries.
// Only called when the execution is linked to a project (projectID != Nil).
// Runs in a background goroutine — failures are logged, never surfaced to the user.
func (o *Orchestrator) extractAndIngestProjectFacts(ctx context.Context, wfID, execID, projectID uuid.UUID, objective, result string, msgs []*models.Message) {
	if o.knowledgeManager == nil {
		return
	}

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

	// Build a compressed view of agent messages (tool outputs, file ops, service calls)
	var msgSnippets []string
	for _, msg := range msgs {
		if msg.Role != models.MessageRoleAssistant || len(msg.Content) < 50 {
			continue
		}
		snippet := msg.Content
		if len(snippet) > 600 {
			snippet = snippet[:600] + "…"
		}
		msgSnippets = append(msgSnippets, fmt.Sprintf("[%s] %s", msg.AgentName, snippet))
		if len(msgSnippets) >= 10 {
			break
		}
	}

	truncResult := result
	if len(truncResult) > 2000 {
		truncResult = truncResult[:2000] + "\n…[truncated]"
	}

	agentContext := strings.Join(msgSnippets, "\n\n---\n\n")
	if agentContext == "" {
		agentContext = "(no agent messages available)"
	}

	prompt := fmt.Sprintf(
		"You are extracting concrete, project-scoped facts from a completed AI agent execution.\n\n"+
			"OBJECTIVE: %s\n\n"+
			"FINAL RESULT:\n%s\n\n"+
			"AGENT ACTIVITY SUMMARY:\n%s\n\n"+
			"Extract up to 8 facts that future agents working on this same project should know.\n"+
			"Focus ONLY on specifics: exact file paths, directory structures, service names, API endpoints,\n"+
			"command-line invocations, configuration keys, database names, port numbers, credential names,\n"+
			"tool call patterns that worked. Group related facts under a descriptive title.\n"+
			"Skip general lessons ('test before deploying') — those go elsewhere. Only include facts\n"+
			"that are specific to THIS project's actual state.\n\n"+
			"Respond with ONLY this JSON (no markdown, no extra text):\n"+
			`{"facts":[{"title":"short descriptive title (max 80 chars)","content":"concrete fact(s), be specific"}]}`,
		objective, truncResult, agentContext,
	)

	resp, err := eng.Submit(ctx, engine.TaskRequest{
		AgentName:    "fact-extractor",
		Model:        modelName,
		SystemPrompt: "You are a knowledge extraction assistant. Extract only concrete, project-specific facts. Respond only with the requested JSON.",
		Message:      prompt,
	})
	if err != nil {
		log.Printf("knowledge: project fact extraction LLM call failed for exec %s: %v", execID, err)
		return
	}

	raw := resp.Content
	if start := strings.Index(raw, "{"); start >= 0 {
		raw = raw[start:]
	}
	if end := strings.LastIndex(raw, "}"); end >= 0 {
		raw = raw[:end+1]
	}

	var parsed struct {
		Facts []struct {
			Title   string `json:"title"`
			Content string `json:"content"`
		} `json:"facts"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		log.Printf("knowledge: project fact parse failed for exec %s: %v (raw: %s)", execID, err, truncateStr(raw, 200))
		return
	}

	facts := make([]knowledge.ProjectFact, 0, len(parsed.Facts))
	for _, f := range parsed.Facts {
		if f.Title != "" && f.Content != "" {
			facts = append(facts, knowledge.ProjectFact{Title: f.Title, Content: f.Content})
		}
	}
	if len(facts) == 0 {
		return
	}

	o.knowledgeManager.IngestProjectFacts(ctx, wfID, projectID, execID, facts)
	log.Printf("knowledge: ingested %d project facts for execution %s (project %s)", len(facts), execID, projectID)
}
