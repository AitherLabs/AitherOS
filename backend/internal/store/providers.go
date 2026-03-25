package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

func (s *Store) CreateProvider(ctx context.Context, req models.CreateProviderRequest) (*models.ModelProvider, error) {
	configJSON, err := json.Marshal(req.Config)
	if err != nil {
		configJSON = []byte("{}")
	}

	provider := &models.ModelProvider{}
	err = s.pool.QueryRow(ctx,
		`INSERT INTO model_providers (name, provider_type, base_url, api_key, is_enabled, is_default, config)
		 VALUES ($1, $2, $3, $4, true, $5, $6)
		 RETURNING id, name, provider_type, base_url, api_key, is_enabled, is_default, config, created_at, updated_at`,
		req.Name, req.ProviderType, req.BaseURL, req.APIKey, req.IsDefault, configJSON,
	).Scan(
		&provider.ID, &provider.Name, &provider.ProviderType, &provider.BaseURL, &provider.APIKey,
		&provider.IsEnabled, &provider.IsDefault, &configJSON, &provider.CreatedAt, &provider.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create provider: %w", err)
	}
	json.Unmarshal(configJSON, &provider.Config)

	// If this is set as default, unset other defaults
	if req.IsDefault {
		s.pool.Exec(ctx, `UPDATE model_providers SET is_default = false WHERE id != $1`, provider.ID)
	}

	return provider, nil
}

func (s *Store) GetProvider(ctx context.Context, id uuid.UUID) (*models.ModelProvider, error) {
	provider := &models.ModelProvider{}
	var configJSON []byte

	err := s.pool.QueryRow(ctx,
		`SELECT id, name, provider_type, base_url, api_key, is_enabled, is_default, config, created_at, updated_at
		 FROM model_providers WHERE id = $1`, id,
	).Scan(
		&provider.ID, &provider.Name, &provider.ProviderType, &provider.BaseURL, &provider.APIKey,
		&provider.IsEnabled, &provider.IsDefault, &configJSON, &provider.CreatedAt, &provider.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("provider not found: %w", err)
	}
	json.Unmarshal(configJSON, &provider.Config)

	// Load associated models
	rows, err := s.pool.Query(ctx,
		`SELECT id, provider_id, model_name, model_type, is_enabled, config, created_at, updated_at
		 FROM provider_models WHERE provider_id = $1 ORDER BY model_name`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var m models.ProviderModel
			var mConfigJSON []byte
			rows.Scan(&m.ID, &m.ProviderID, &m.ModelName, &m.ModelType, &m.IsEnabled, &mConfigJSON, &m.CreatedAt, &m.UpdatedAt)
			json.Unmarshal(mConfigJSON, &m.Config)
			provider.Models = append(provider.Models, m)
		}
	}

	return provider, nil
}

func (s *Store) ListProviders(ctx context.Context) ([]*models.ModelProvider, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, provider_type, base_url, is_enabled, is_default, config, created_at, updated_at
		 FROM model_providers ORDER BY is_default DESC, name`)
	if err != nil {
		return nil, fmt.Errorf("list providers: %w", err)
	}
	defer rows.Close()

	var providers []*models.ModelProvider
	for rows.Next() {
		p := &models.ModelProvider{}
		var configJSON []byte
		err := rows.Scan(&p.ID, &p.Name, &p.ProviderType, &p.BaseURL, &p.IsEnabled, &p.IsDefault, &configJSON, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			continue
		}
		json.Unmarshal(configJSON, &p.Config)
		providers = append(providers, p)
	}

	return providers, nil
}

func (s *Store) UpdateProvider(ctx context.Context, id uuid.UUID, req models.UpdateProviderRequest) (*models.ModelProvider, error) {
	// Build dynamic update
	setClauses := []string{"updated_at = NOW()"}
	args := []any{id}
	argIdx := 2

	if req.Name != nil {
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, *req.Name)
		argIdx++
	}
	if req.BaseURL != nil {
		setClauses = append(setClauses, fmt.Sprintf("base_url = $%d", argIdx))
		args = append(args, *req.BaseURL)
		argIdx++
	}
	if req.APIKey != nil {
		setClauses = append(setClauses, fmt.Sprintf("api_key = $%d", argIdx))
		args = append(args, *req.APIKey)
		argIdx++
	}
	if req.IsEnabled != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_enabled = $%d", argIdx))
		args = append(args, *req.IsEnabled)
		argIdx++
	}
	if req.IsDefault != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_default = $%d", argIdx))
		args = append(args, *req.IsDefault)
		argIdx++
	}
	if req.Config != nil {
		configJSON, _ := json.Marshal(req.Config)
		setClauses = append(setClauses, fmt.Sprintf("config = $%d", argIdx))
		args = append(args, configJSON)
		argIdx++
	}

	query := fmt.Sprintf("UPDATE model_providers SET %s WHERE id = $1", joinClauses(setClauses))
	_, err := s.pool.Exec(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("update provider: %w", err)
	}

	// If setting as default, unset others
	if req.IsDefault != nil && *req.IsDefault {
		s.pool.Exec(ctx, `UPDATE model_providers SET is_default = false WHERE id != $1`, id)
	}

	return s.GetProvider(ctx, id)
}

func (s *Store) DeleteProvider(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM model_providers WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete provider: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("provider not found")
	}
	return nil
}

// GetDefaultProvider returns the default provider, or nil if none is set.
func (s *Store) GetDefaultProvider(ctx context.Context) (*models.ModelProvider, error) {
	provider := &models.ModelProvider{}
	var configJSON []byte
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, provider_type, base_url, api_key, is_enabled, is_default, config, created_at, updated_at
		 FROM model_providers WHERE is_default = true AND is_enabled = true LIMIT 1`,
	).Scan(
		&provider.ID, &provider.Name, &provider.ProviderType, &provider.BaseURL, &provider.APIKey,
		&provider.IsEnabled, &provider.IsDefault, &configJSON, &provider.CreatedAt, &provider.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("no default provider: %w", err)
	}
	json.Unmarshal(configJSON, &provider.Config)
	return provider, nil
}

// --- Provider Models ---

func (s *Store) CreateProviderModel(ctx context.Context, providerID uuid.UUID, req models.CreateProviderModelRequest) (*models.ProviderModel, error) {
	configJSON, _ := json.Marshal(req.Config)

	m := &models.ProviderModel{}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO provider_models (provider_id, model_name, model_type, is_enabled, config)
		 VALUES ($1, $2, $3, true, $4)
		 RETURNING id, provider_id, model_name, model_type, is_enabled, config, created_at, updated_at`,
		providerID, req.ModelName, req.ModelType, configJSON,
	).Scan(&m.ID, &m.ProviderID, &m.ModelName, &m.ModelType, &m.IsEnabled, &configJSON, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create provider model: %w", err)
	}
	json.Unmarshal(configJSON, &m.Config)
	return m, nil
}

func (s *Store) DeleteProviderModel(ctx context.Context, modelID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM provider_models WHERE id = $1`, modelID)
	if err != nil {
		return fmt.Errorf("delete provider model: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("provider model not found")
	}
	return nil
}

func joinClauses(clauses []string) string {
	result := ""
	for i, c := range clauses {
		if i > 0 {
			result += ", "
		}
		result += c
	}
	return result
}
