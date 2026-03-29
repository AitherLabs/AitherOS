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
			Title:       extractContentTitle(msg.AgentName, msg.Content),
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
	if content == "" {
		return nil, fmt.Errorf("content is required")
	}

	// Embed if available; store without a vector if not (entry still appears in the
	// list and can be embedded later — RAG search already filters to embedding IS NOT NULL).
	var embedding []float32
	if m.embedder.Available() {
		textToEmbed := content
		if title != "" {
			textToEmbed = fmt.Sprintf("%s\n\n%s", title, content)
		}
		if len(textToEmbed) > 8000 {
			textToEmbed = textToEmbed[:8000]
		}
		if emb, err := m.embedder.Embed(ctx, textToEmbed); err != nil {
			log.Printf("knowledge: embed manual entry (non-fatal): %v", err)
		} else {
			embedding = emb
		}
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

// Lesson is a distilled, reusable piece of knowledge extracted from a completed execution.
type Lesson struct {
	Title   string
	Content string
}

// IngestLessons embeds and stores structured lessons extracted from a completed execution.
func (m *Manager) IngestLessons(ctx context.Context, workforceID, executionID uuid.UUID, lessons []Lesson) {
	if !m.embedder.Available() {
		return
	}
	for _, l := range lessons {
		if l.Title == "" || l.Content == "" {
			continue
		}
		textToEmbed := l.Title + "\n\n" + l.Content
		embedding, err := m.embedder.Embed(ctx, textToEmbed)
		if err != nil {
			log.Printf("knowledge: embed lesson %q: %v", l.Title, err)
			continue
		}
		entry := &models.KnowledgeEntry{
			ID:          uuid.New(),
			WorkforceID: workforceID,
			ExecutionID: &executionID,
			SourceType:  models.KnowledgeSourceLesson,
			Title:       truncate(l.Title, 120),
			Content:     l.Content,
			Embedding:   embedding,
			Metadata:    map[string]any{},
			CreatedAt:   time.Now(),
		}
		if err := m.store.CreateKnowledgeEntry(ctx, entry); err != nil {
			log.Printf("knowledge: store lesson %q: %v", l.Title, err)
		}
	}
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

	var lessons, others []string
	for _, r := range results {
		content := r.Content
		if len(content) > 1200 {
			content = content[:1200] + "..."
		}
		if r.SourceType == models.KnowledgeSourceLesson {
			if r.Similarity < 0.25 {
				continue
			}
			lessons = append(lessons, fmt.Sprintf("[LESSON: %s] %s", r.Title, content))
		} else {
			if r.Similarity < 0.5 {
				continue
			}
			others = append(others, fmt.Sprintf("[%s | %.0f%% match] %s", r.Title, r.Similarity*100, content))
		}
	}

	parts := append(lessons, others...)
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
	_ = ctx
	go func() {
		bgCtx := context.Background()
		var embedding []float32
		if m.embedder.Available() {
			textToEmbed := fmt.Sprintf("Agent: %s\n\n%s", agentName, content)
			if len(textToEmbed) > 8000 {
				textToEmbed = textToEmbed[:8000]
			}
			if emb, err := m.embedder.Embed(bgCtx, textToEmbed); err != nil {
				log.Printf("knowledge: embed single message (%s iter=%d, non-fatal): %v", agentName, iteration, err)
			} else {
				embedding = emb
			}
		}
		entry := &models.KnowledgeEntry{
			ID:          uuid.New(),
			WorkforceID: workforceID,
			ExecutionID: &executionID,
			AgentID:     agentID,
			SourceType:  models.KnowledgeSourceAgent,
			Title:       extractContentTitle(agentName, content),
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

	var lessons, others []string
	for _, r := range results {
		content := r.Content
		if len(content) > 1500 {
			content = content[:1500] + "..."
		}
		if r.SourceType == models.KnowledgeSourceLesson {
			if r.Similarity < 0.25 {
				continue
			}
			lessons = append(lessons, fmt.Sprintf("[LESSON: %s] %s", r.Title, content))
		} else {
			if r.Similarity < 0.5 {
				continue
			}
			others = append(others, fmt.Sprintf("[%s | %.0f%% match] %s", r.Title, r.Similarity*100, content))
		}
	}

	parts := append(lessons, others...)
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

// extractContentTitle builds a human-readable title for an auto-ingested agent message.
// It tries to use the first meaningful heading or sentence from the content, falling back
// to a truncated prefix. The result is prefixed with the agent name.
func extractContentTitle(agentName, content string) string {
	const maxTitle = 100
	for _, line := range strings.SplitN(content, "\n", 8) {
		line = strings.TrimSpace(line)
		// Strip markdown heading markers
		line = strings.TrimLeft(line, "#")
		line = strings.TrimSpace(line)
		if len(line) >= 12 && len(line) <= maxTitle {
			return fmt.Sprintf("%s: %s", agentName, line)
		}
	}
	// Fallback: first maxTitle chars of content
	snippet := strings.TrimSpace(content)
	if len(snippet) > maxTitle {
		snippet = snippet[:maxTitle] + "…"
	}
	return fmt.Sprintf("%s: %s", agentName, snippet)
}
