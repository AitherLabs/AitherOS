package store

import (
	"context"
	"fmt"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ListSkills returns all skills ordered by source (official first), then category, then name.
func (s *Store) ListSkills(ctx context.Context) ([]models.Skill, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, slug, description, content, category, source, author, repo_url, version, icon, tags, created_at, updated_at
		FROM skills
		ORDER BY CASE source WHEN 'official' THEN 0 ELSE 1 END, category, name`)
	if err != nil {
		return nil, fmt.Errorf("list skills: %w", err)
	}
	defer rows.Close()

	var skills []models.Skill
	for rows.Next() {
		var sk models.Skill
		if err := rows.Scan(
			&sk.ID, &sk.Name, &sk.Slug, &sk.Description, &sk.Content,
			&sk.Category, &sk.Source, &sk.Author, &sk.RepoURL, &sk.Version,
			&sk.Icon, &sk.Tags, &sk.CreatedAt, &sk.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan skill: %w", err)
		}
		skills = append(skills, sk)
	}
	return skills, nil
}

// GetSkill returns a single skill by ID.
func (s *Store) GetSkill(ctx context.Context, id uuid.UUID) (*models.Skill, error) {
	var sk models.Skill
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, slug, description, content, category, source, author, repo_url, version, icon, tags, created_at, updated_at
		FROM skills WHERE id = $1`, id,
	).Scan(
		&sk.ID, &sk.Name, &sk.Slug, &sk.Description, &sk.Content,
		&sk.Category, &sk.Source, &sk.Author, &sk.RepoURL, &sk.Version,
		&sk.Icon, &sk.Tags, &sk.CreatedAt, &sk.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("skill not found: %s", id)
		}
		return nil, fmt.Errorf("get skill: %w", err)
	}
	return &sk, nil
}

// GetAgentSkills returns all skills assigned to an agent, ordered by position then assigned_at.
func (s *Store) GetAgentSkills(ctx context.Context, agentID uuid.UUID) ([]models.Skill, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT s.id, s.name, s.slug, s.description, s.content, s.category, s.source,
		       s.author, s.repo_url, s.version, s.icon, s.tags, s.created_at, s.updated_at
		FROM agent_skills ags
		JOIN skills s ON s.id = ags.skill_id
		WHERE ags.agent_id = $1
		ORDER BY ags.position, ags.assigned_at`, agentID)
	if err != nil {
		return nil, fmt.Errorf("get agent skills: %w", err)
	}
	defer rows.Close()

	var skills []models.Skill
	for rows.Next() {
		var sk models.Skill
		if err := rows.Scan(
			&sk.ID, &sk.Name, &sk.Slug, &sk.Description, &sk.Content,
			&sk.Category, &sk.Source, &sk.Author, &sk.RepoURL, &sk.Version,
			&sk.Icon, &sk.Tags, &sk.CreatedAt, &sk.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan agent skill: %w", err)
		}
		skills = append(skills, sk)
	}
	return skills, nil
}

// AssignSkill links a skill to an agent. Silently no-ops if already assigned.
func (s *Store) AssignSkill(ctx context.Context, agentID, skillID uuid.UUID, position int) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO agent_skills (agent_id, skill_id, position)
		VALUES ($1, $2, $3)
		ON CONFLICT (agent_id, skill_id) DO UPDATE SET position = EXCLUDED.position`,
		agentID, skillID, position,
	)
	if err != nil {
		return fmt.Errorf("assign skill: %w", err)
	}
	return nil
}

// RemoveSkill unlinks a skill from an agent.
func (s *Store) RemoveSkill(ctx context.Context, agentID, skillID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM agent_skills WHERE agent_id = $1 AND skill_id = $2`,
		agentID, skillID,
	)
	if err != nil {
		return fmt.Errorf("remove skill: %w", err)
	}
	return nil
}
