package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/pgvector/pgvector-go"
)

// ── Knowledge Entries CRUD ──

func (s *Store) CreateKnowledgeEntry(ctx context.Context, entry *models.KnowledgeEntry) error {
	if entry.ID == uuid.Nil {
		entry.ID = uuid.New()
	}
	if entry.Metadata == nil {
		entry.Metadata = map[string]any{}
	}
	metaJSON, _ := json.Marshal(entry.Metadata)

	var emb *pgvector.Vector
	if len(entry.Embedding) > 0 {
		v := pgvector.NewVector(entry.Embedding)
		emb = &v
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO knowledge_entries (id, workforce_id, project_id, execution_id, agent_id, source_type, title, content, embedding, metadata, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		entry.ID, entry.WorkforceID, entry.ProjectID, entry.ExecutionID, entry.AgentID,
		entry.SourceType, entry.Title, entry.Content, emb, metaJSON, entry.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert knowledge_entry: %w", err)
	}
	return nil
}

// SearchKnowledge finds the most similar knowledge entries for a workforce using cosine similarity.
func (s *Store) SearchKnowledge(ctx context.Context, workforceID uuid.UUID, queryEmbedding []float32, limit int) ([]models.KnowledgeEntry, error) {
	if limit <= 0 {
		limit = 5
	}
	if limit > 20 {
		limit = 20
	}

	qv := pgvector.NewVector(queryEmbedding)

	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, project_id, execution_id, agent_id, source_type, title, content, metadata, created_at,
		       1 - (embedding::vector(768) <=> $1) AS similarity
		FROM knowledge_entries
		WHERE workforce_id = $2 AND embedding IS NOT NULL
		ORDER BY embedding::vector(768) <=> $1
		LIMIT $3`,
		qv, workforceID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("search knowledge: %w", err)
	}
	defer rows.Close()

	var results []models.KnowledgeEntry
	for rows.Next() {
		var e models.KnowledgeEntry
		var metaJSON []byte
		err := rows.Scan(
			&e.ID, &e.WorkforceID, &e.ProjectID, &e.ExecutionID, &e.AgentID,
			&e.SourceType, &e.Title, &e.Content, &metaJSON, &e.CreatedAt,
			&e.Similarity,
		)
		if err != nil {
			return nil, fmt.Errorf("scan knowledge_entry: %w", err)
		}
		json.Unmarshal(metaJSON, &e.Metadata)
		results = append(results, e)
	}
	return results, nil
}

// SearchKnowledgeByAgent finds the most similar knowledge entries for a specific agent across all executions.
// Used for per-agent episodic memory: Daedalus can recall what it did in past executions.
func (s *Store) SearchKnowledgeByAgent(ctx context.Context, agentID uuid.UUID, queryEmbedding []float32, limit int) ([]models.KnowledgeEntry, error) {
	if limit <= 0 {
		limit = 5
	}
	if limit > 20 {
		limit = 20
	}

	qv := pgvector.NewVector(queryEmbedding)

	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, project_id, execution_id, agent_id, source_type, title, content, metadata, created_at,
		       1 - (embedding::vector(768) <=> $1) AS similarity
		FROM knowledge_entries
		WHERE agent_id = $2 AND embedding IS NOT NULL
		ORDER BY embedding::vector(768) <=> $1
		LIMIT $3`,
		qv, agentID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("search knowledge by agent: %w", err)
	}
	defer rows.Close()

	var results []models.KnowledgeEntry
	for rows.Next() {
		var e models.KnowledgeEntry
		var metaJSON []byte
		err := rows.Scan(
			&e.ID, &e.WorkforceID, &e.ProjectID, &e.ExecutionID, &e.AgentID,
			&e.SourceType, &e.Title, &e.Content, &metaJSON, &e.CreatedAt,
			&e.Similarity,
		)
		if err != nil {
			return nil, fmt.Errorf("scan knowledge_entry: %w", err)
		}
		json.Unmarshal(metaJSON, &e.Metadata)
		results = append(results, e)
	}
	return results, nil
}

// SearchKnowledgeByProject finds the most similar project_fact entries for a given project.
// Used for project-scoped RAG: inject relevant concrete facts into agent prompts.
func (s *Store) SearchKnowledgeByProject(ctx context.Context, projectID uuid.UUID, queryEmbedding []float32, limit int) ([]models.KnowledgeEntry, error) {
	if limit <= 0 {
		limit = 5
	}
	if limit > 20 {
		limit = 20
	}

	qv := pgvector.NewVector(queryEmbedding)

	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, project_id, execution_id, agent_id, source_type, title, content, metadata, created_at,
		       1 - (embedding::vector(768) <=> $1) AS similarity
		FROM knowledge_entries
		WHERE project_id = $2 AND source_type = 'project_fact' AND embedding IS NOT NULL
		ORDER BY embedding::vector(768) <=> $1
		LIMIT $3`,
		qv, projectID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("search knowledge by project: %w", err)
	}
	defer rows.Close()

	var results []models.KnowledgeEntry
	for rows.Next() {
		var e models.KnowledgeEntry
		var metaJSON []byte
		err := rows.Scan(
			&e.ID, &e.WorkforceID, &e.ProjectID, &e.ExecutionID, &e.AgentID,
			&e.SourceType, &e.Title, &e.Content, &metaJSON, &e.CreatedAt,
			&e.Similarity,
		)
		if err != nil {
			return nil, fmt.Errorf("scan knowledge_entry: %w", err)
		}
		json.Unmarshal(metaJSON, &e.Metadata)
		results = append(results, e)
	}
	return results, nil
}

// ListKnowledge lists knowledge entries for a workforce (no vector search, just chronological).
func (s *Store) ListKnowledge(ctx context.Context, workforceID uuid.UUID, limit int) ([]models.KnowledgeEntry, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, project_id, execution_id, agent_id, source_type, title, content, metadata, created_at
		FROM knowledge_entries
		WHERE workforce_id = $1
		ORDER BY created_at DESC
		LIMIT $2`,
		workforceID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list knowledge: %w", err)
	}
	defer rows.Close()

	var results []models.KnowledgeEntry
	for rows.Next() {
		var e models.KnowledgeEntry
		var metaJSON []byte
		err := rows.Scan(
			&e.ID, &e.WorkforceID, &e.ProjectID, &e.ExecutionID, &e.AgentID,
			&e.SourceType, &e.Title, &e.Content, &metaJSON, &e.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan knowledge_entry: %w", err)
		}
		json.Unmarshal(metaJSON, &e.Metadata)
		results = append(results, e)
	}
	return results, nil
}

// ListKnowledgePaged lists knowledge entries with pagination and returns the total count.
func (s *Store) ListKnowledgePaged(ctx context.Context, workforceID uuid.UUID, limit, offset int) ([]models.KnowledgeEntry, int, error) {
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM knowledge_entries WHERE workforce_id = $1`, workforceID,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count knowledge: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, project_id, execution_id, agent_id, source_type, title, content, metadata, created_at
		FROM knowledge_entries
		WHERE workforce_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`,
		workforceID, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list knowledge paged: %w", err)
	}
	defer rows.Close()

	var results []models.KnowledgeEntry
	for rows.Next() {
		var e models.KnowledgeEntry
		var metaJSON []byte
		if err := rows.Scan(
			&e.ID, &e.WorkforceID, &e.ProjectID, &e.ExecutionID, &e.AgentID,
			&e.SourceType, &e.Title, &e.Content, &metaJSON, &e.CreatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan knowledge_entry: %w", err)
		}
		json.Unmarshal(metaJSON, &e.Metadata)
		results = append(results, e)
	}
	return results, total, nil
}

// ListKnowledgeByProject lists project_fact entries for a project (chronological, newest first).
func (s *Store) ListKnowledgeByProject(ctx context.Context, projectID uuid.UUID, limit int) ([]models.KnowledgeEntry, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, project_id, execution_id, agent_id, source_type, title, content, metadata, created_at
		FROM knowledge_entries
		WHERE project_id = $1 AND source_type = 'project_fact'
		ORDER BY created_at DESC
		LIMIT $2`,
		projectID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list knowledge by project: %w", err)
	}
	defer rows.Close()

	var results []models.KnowledgeEntry
	for rows.Next() {
		var e models.KnowledgeEntry
		var metaJSON []byte
		if err := rows.Scan(
			&e.ID, &e.WorkforceID, &e.ProjectID, &e.ExecutionID, &e.AgentID,
			&e.SourceType, &e.Title, &e.Content, &metaJSON, &e.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan knowledge_entry: %w", err)
		}
		json.Unmarshal(metaJSON, &e.Metadata)
		results = append(results, e)
	}
	return results, nil
}

// GetKnowledgeEntry retrieves a single knowledge entry by ID.
func (s *Store) GetKnowledgeEntry(ctx context.Context, id uuid.UUID) (*models.KnowledgeEntry, error) {
	var e models.KnowledgeEntry
	var metaJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, workforce_id, project_id, execution_id, agent_id, source_type, title, content, metadata, created_at
		FROM knowledge_entries WHERE id = $1`, id,
	).Scan(
		&e.ID, &e.WorkforceID, &e.ProjectID, &e.ExecutionID, &e.AgentID,
		&e.SourceType, &e.Title, &e.Content, &metaJSON, &e.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("knowledge_entry not found: %s", id)
		}
		return nil, fmt.Errorf("get knowledge_entry: %w", err)
	}
	json.Unmarshal(metaJSON, &e.Metadata)
	return &e, nil
}

// DeleteKnowledgeEntry removes a knowledge entry.
func (s *Store) DeleteKnowledgeEntry(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM knowledge_entries WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete knowledge_entry: %w", err)
	}
	return nil
}

// CountKnowledge returns the total number of knowledge entries for a workforce.
func (s *Store) CountKnowledge(ctx context.Context, workforceID uuid.UUID) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM knowledge_entries WHERE workforce_id = $1`, workforceID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count knowledge: %w", err)
	}
	return count, nil
}
