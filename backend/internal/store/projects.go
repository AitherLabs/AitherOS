package store

import (
	"context"
	"fmt"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ListProjects(ctx context.Context, workforceID uuid.UUID) ([]*models.Project, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, name, description, status, icon, color, created_at, updated_at
		FROM projects
		WHERE workforce_id = $1
		ORDER BY created_at DESC`, workforceID)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()

	projects := []*models.Project{}
	for rows.Next() {
		p := &models.Project{}
		if err := rows.Scan(&p.ID, &p.WorkforceID, &p.Name, &p.Description, &p.Status, &p.Icon, &p.Color, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		projects = append(projects, p)
	}
	return projects, nil
}

func (s *Store) GetProject(ctx context.Context, id uuid.UUID) (*models.Project, error) {
	p := &models.Project{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, workforce_id, name, description, status, icon, color, created_at, updated_at
		FROM projects WHERE id = $1`, id,
	).Scan(&p.ID, &p.WorkforceID, &p.Name, &p.Description, &p.Status, &p.Icon, &p.Color, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("project not found: %s", id)
		}
		return nil, fmt.Errorf("get project: %w", err)
	}
	return p, nil
}

func (s *Store) CreateProject(ctx context.Context, workforceID uuid.UUID, req models.CreateProjectRequest) (*models.Project, error) {
	p := &models.Project{
		ID:          uuid.New(),
		WorkforceID: workforceID,
		Name:        req.Name,
		Description: req.Description,
		Status:      models.ProjectStatusActive,
		Icon:        req.Icon,
		Color:       req.Color,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if p.Icon == "" {
		p.Icon = "📁"
	}
	if p.Color == "" {
		p.Color = "#9A66FF"
	}
	if req.Status != "" {
		p.Status = models.ProjectStatus(req.Status)
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO projects (id, workforce_id, name, description, status, icon, color, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		p.ID, p.WorkforceID, p.Name, p.Description, p.Status, p.Icon, p.Color, p.CreatedAt, p.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert project: %w", err)
	}
	return p, nil
}

func (s *Store) UpdateProject(ctx context.Context, id uuid.UUID, req models.UpdateProjectRequest) (*models.Project, error) {
	p, err := s.GetProject(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		p.Name = *req.Name
	}
	if req.Description != nil {
		p.Description = *req.Description
	}
	if req.Status != nil {
		p.Status = models.ProjectStatus(*req.Status)
	}
	if req.Icon != nil {
		p.Icon = *req.Icon
	}
	if req.Color != nil {
		p.Color = *req.Color
	}
	p.UpdatedAt = time.Now()

	_, err = s.pool.Exec(ctx, `
		UPDATE projects SET name=$2, description=$3, status=$4, icon=$5, color=$6, updated_at=$7
		WHERE id=$1`,
		p.ID, p.Name, p.Description, p.Status, p.Icon, p.Color, p.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update project: %w", err)
	}
	return p, nil
}

func (s *Store) DeleteProject(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM projects WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("project not found: %s", id)
	}
	return nil
}
