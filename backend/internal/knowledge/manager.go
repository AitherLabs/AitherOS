package knowledge

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

// Manager handles knowledge base operations: embedding, storing, and RAG retrieval.
type Manager struct {
	store    *store.Store
	embedder *Embedder
}

func NewManager(s *store.Store, embedder *Embedder) *Manager {
	return &Manager{
		store:    s,
		embedder: embedder,
	}
}

// IngestExecutionResult embeds and stores an execution's final result into the
// workforce's knowledge base. Called when an execution completes.
func (m *Manager) IngestExecutionResult(ctx context.Context, workforceID, executionID uuid.UUID, objective, result string) error {
	if !m.embedder.Available() {
		return nil
	}
	if result == "" || len(result) < 20 {
		return nil // Skip trivial results
	}

	// Build a rich text for embedding that includes context
	textToEmbed := fmt.Sprintf("Objective: %s\n\nResult: %s", objective, result)

	// Truncate to avoid excessive token usage (embeddings models have limits)
	if len(textToEmbed) > 8000 {
		textToEmbed = textToEmbed[:8000]
	}

	embedding, err := m.embedder.Embed(ctx, textToEmbed)
	if err != nil {
		return fmt.Errorf("embed execution result: %w", err)
	}

	entry := &models.KnowledgeEntry{
		ID:          uuid.New(),
		WorkforceID: workforceID,
		ExecutionID: &executionID,
		SourceType:  models.KnowledgeSourceExecution,
		Title:       truncate(objective, 200),
		Content:     result,
		Embedding:   embedding,
		Metadata: map[string]any{
			"objective":    objective,
			"execution_id": executionID.String(),
		},
		CreatedAt: time.Now(),
	}

	return m.store.CreateKnowledgeEntry(ctx, entry)
}

// IngestAgentMessages embeds and stores significant agent messages from an execution.
// Only stores messages that are long enough to contain useful knowledge.
func (m *Manager) IngestAgentMessages(ctx context.Context, workforceID, executionID uuid.UUID, messages []*models.Message) {
	if !m.embedder.Available() {
		return
	}
	for _, msg := range messages {
		if msg.Role != models.MessageRoleAssistant {
			continue
		}
		if len(msg.Content) < 100 {
			continue // Skip short messages
		}

		textToEmbed := fmt.Sprintf("Agent: %s\n\n%s", msg.AgentName, msg.Content)
		if len(textToEmbed) > 8000 {
			textToEmbed = textToEmbed[:8000]
		}

		embedding, err := m.embedder.Embed(ctx, textToEmbed)
		if err != nil {
			log.Printf("knowledge: embed agent message %s: %v", msg.ID, err)
			continue
		}

		entry := &models.KnowledgeEntry{
			ID:          uuid.New(),
			WorkforceID: workforceID,
			ExecutionID: &executionID,
			AgentID:     msg.AgentID,
			SourceType:  models.KnowledgeSourceAgent,
			Title:       fmt.Sprintf("%s - Iteration %d", msg.AgentName, msg.Iteration),
			Content:     msg.Content,
			Embedding:   embedding,
			Metadata: map[string]any{
				"agent_name": msg.AgentName,
				"iteration":  msg.Iteration,
				"model":      msg.Model,
			},
			CreatedAt: time.Now(),
		}

		if err := m.store.CreateKnowledgeEntry(ctx, entry); err != nil {
			log.Printf("knowledge: store agent message %s: %v", msg.ID, err)
		}
	}
}

// IngestManual embeds and stores user-provided knowledge.
func (m *Manager) IngestManual(ctx context.Context, workforceID uuid.UUID, title, content string) (*models.KnowledgeEntry, error) {
	if !m.embedder.Available() {
		return nil, fmt.Errorf("embeddings are not available — check your EMBEDDING_MODEL configuration")
	}
	if content == "" {
		return nil, fmt.Errorf("content is required")
	}

	textToEmbed := content
	if title != "" {
		textToEmbed = fmt.Sprintf("%s\n\n%s", title, content)
	}
	if len(textToEmbed) > 8000 {
		textToEmbed = textToEmbed[:8000]
	}

	embedding, err := m.embedder.Embed(ctx, textToEmbed)
	if err != nil {
		return nil, fmt.Errorf("embed: %w", err)
	}

	entry := &models.KnowledgeEntry{
		ID:          uuid.New(),
		WorkforceID: workforceID,
		SourceType:  models.KnowledgeSourceManual,
		Title:       title,
		Content:     content,
		Embedding:   embedding,
		Metadata:    map[string]any{},
		CreatedAt:   time.Now(),
	}

	if err := m.store.CreateKnowledgeEntry(ctx, entry); err != nil {
		return nil, err
	}
	return entry, nil
}

// RetrieveRelevantForAgent retrieves the top-K most relevant past interactions for a
// specific agent across ALL executions. This gives agents long-term episodic memory:
// Daedalus can recall that it documented the MCP system last week.
func (m *Manager) RetrieveRelevantForAgent(ctx context.Context, agentID uuid.UUID, query string, limit int) (string, error) {
	if !m.embedder.Available() {
		return "", nil
	}
	if limit <= 0 {
		limit = 3
	}

	embedding, err := m.embedder.Embed(ctx, query)
	if err != nil {
		return "", fmt.Errorf("embed query: %w", err)
	}

	results, err := m.store.SearchKnowledgeByAgent(ctx, agentID, embedding, limit)
	if err != nil {
		return "", fmt.Errorf("search agent memory: %w", err)
	}

	var parts []string
	for _, r := range results {
		if r.Similarity < 0.3 {
			continue
		}
		content := r.Content
		if len(content) > 1200 {
			content = content[:1200] + "..."
		}
		parts = append(parts, fmt.Sprintf("[%s | %.0f%% match] %s", r.Title, r.Similarity*100, content))
	}

	if len(parts) == 0 {
		return "", nil
	}
	return strings.Join(parts, "\n\n---\n\n"), nil
}

// IngestSingleMessage embeds a single agent response message immediately after it is
// produced (mid-execution), rather than waiting until execution completes.
// This allows cross-agent and cross-execution knowledge to accumulate in real time.
func (m *Manager) IngestSingleMessage(ctx context.Context, workforceID, executionID uuid.UUID, agentID *uuid.UUID, agentName string, iteration int, content, model string) {
	if len(content) < 100 {
		return // skip trivial messages
	}
	// Use a detached context — the execution context may cancel before the goroutine finishes.
	_ = ctx
	go func() {
		bgCtx := context.Background()
		textToEmbed := fmt.Sprintf("Agent: %s\n\n%s", agentName, content)
		if len(textToEmbed) > 8000 {
			textToEmbed = textToEmbed[:8000]
		}
		embedding, err := m.embedder.Embed(bgCtx, textToEmbed)
		if err != nil {
			log.Printf("knowledge: embed single message (%s iter=%d): %v", agentName, iteration, err)
			return
		}
		entry := &models.KnowledgeEntry{
			ID:          uuid.New(),
			WorkforceID: workforceID,
			ExecutionID: &executionID,
			AgentID:     agentID,
			SourceType:  models.KnowledgeSourceAgent,
			Title:       fmt.Sprintf("%s - Subtask (exec %s)", agentName, executionID.String()[:8]),
			Content:     content,
			Embedding:   embedding,
			Metadata: map[string]any{
				"agent_name":   agentName,
				"iteration":    iteration,
				"model":        model,
				"ingest_phase": "mid_execution",
			},
			CreatedAt: time.Now(),
		}
		if err := m.store.CreateKnowledgeEntry(bgCtx, entry); err != nil {
			log.Printf("knowledge: store single message (%s): %v", agentName, err)
		}
	}()
}

// RetrieveRelevant searches the workforce knowledge base for entries relevant to a query.
// Returns formatted context text for injection into agent prompts.
func (m *Manager) RetrieveRelevant(ctx context.Context, workforceID uuid.UUID, query string, limit int) (string, error) {
	if !m.embedder.Available() {
		return "", nil
	}
	if limit <= 0 {
		limit = 5
	}

	embedding, err := m.embedder.Embed(ctx, query)
	if err != nil {
		return "", fmt.Errorf("embed query: %w", err)
	}

	results, err := m.store.SearchKnowledge(ctx, workforceID, embedding, limit)
	if err != nil {
		return "", fmt.Errorf("search: %w", err)
	}

	if len(results) == 0 {
		return "", nil
	}

	// Filter by minimum similarity threshold
	var parts []string
	for _, r := range results {
		if r.Similarity < 0.3 {
			continue // Too dissimilar
		}
		content := r.Content
		if len(content) > 1500 {
			content = content[:1500] + "..."
		}
		parts = append(parts, fmt.Sprintf("[%s | %.0f%% match] %s", r.Title, r.Similarity*100, content))
	}

	if len(parts) == 0 {
		return "", nil
	}

	return strings.Join(parts, "\n\n---\n\n"), nil
}

// RetrieveEmbedding exposes the embedding generation for use by API handlers.
func (m *Manager) RetrieveEmbedding(ctx context.Context, text string) ([]float32, error) {
	return m.embedder.Embed(ctx, text)
}

// ProbeEmbedder runs a live connectivity check against the embedding endpoint.
func (m *Manager) ProbeEmbedder(ctx context.Context) EmbedStatus {
	return m.embedder.Probe(ctx)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
