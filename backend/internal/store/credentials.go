package store

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ── Encryption helpers ────────────────────────────────────────────────────────

// encrypt encrypts plaintext using AES-256-GCM. If key is nil, stores plaintext.
func encrypt(key []byte, plaintext string) (string, error) {
	if len(key) == 0 {
		return plaintext, nil
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return "enc:" + base64.StdEncoding.EncodeToString(ciphertext), nil
}

// decrypt decrypts AES-256-GCM ciphertext produced by encrypt.
// Handles both encrypted ("enc:" prefix) and legacy plaintext values.
func decrypt(key []byte, stored string) (string, error) {
	const prefix = "enc:"
	if len(stored) < len(prefix) || stored[:len(prefix)] != prefix {
		return stored, nil // plaintext (no encryption key was set when stored)
	}
	if len(key) == 0 {
		return "", fmt.Errorf("value is encrypted but no key configured")
	}
	encoded := stored[len(prefix):]
	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm: %w", err)
	}
	if len(ciphertext) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext too short")
	}
	nonce, ct := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", fmt.Errorf("gcm open: %w", err)
	}
	return string(plain), nil
}

// ── Store methods ─────────────────────────────────────────────────────────────

func (s *Store) ListCredentials(ctx context.Context, workforceID uuid.UUID) ([]*models.Credential, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, workforce_id, service, key_name, value, created_at, updated_at
		FROM workforce_credentials
		WHERE workforce_id = $1
		ORDER BY service, key_name`, workforceID)
	if err != nil {
		return nil, fmt.Errorf("list credentials: %w", err)
	}
	defer rows.Close()

	var creds []*models.Credential
	for rows.Next() {
		c := &models.Credential{}
		if err := rows.Scan(&c.ID, &c.WorkforceID, &c.Service, &c.KeyName, &c.Value, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan credential: %w", err)
		}
		c.Value = "****" // always mask on list
		creds = append(creds, c)
	}
	return creds, nil
}

func (s *Store) UpsertCredential(ctx context.Context, workforceID uuid.UUID, req models.UpsertCredentialRequest) (*models.Credential, error) {
	encrypted, err := encrypt(s.encKey, req.Value)
	if err != nil {
		return nil, fmt.Errorf("encrypt: %w", err)
	}

	c := &models.Credential{
		ID:          uuid.New(),
		WorkforceID: workforceID,
		Service:     req.Service,
		KeyName:     req.KeyName,
		Value:       "****",
		UpdatedAt:   time.Now(),
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO workforce_credentials (id, workforce_id, service, key_name, value, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, now(), now())
		ON CONFLICT (workforce_id, service, key_name)
		DO UPDATE SET value = $5, updated_at = now()
		RETURNING id, created_at, updated_at`,
		c.ID, workforceID, req.Service, req.KeyName, encrypted,
	)
	if err != nil {
		return nil, fmt.Errorf("upsert credential: %w", err)
	}

	// Re-read to get the correct id/created_at after upsert
	row := s.pool.QueryRow(ctx, `
		SELECT id, created_at, updated_at FROM workforce_credentials
		WHERE workforce_id=$1 AND service=$2 AND key_name=$3`,
		workforceID, req.Service, req.KeyName)
	row.Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)

	return c, nil
}

func (s *Store) DeleteCredential(ctx context.Context, workforceID uuid.UUID, service, keyName string) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM workforce_credentials
		WHERE workforce_id=$1 AND service=$2 AND key_name=$3`,
		workforceID, service, keyName)
	if err != nil {
		return fmt.Errorf("delete credential: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("credential not found")
	}
	return nil
}

// ExportSecretsFile reads all plaintext credentials for a workforce and writes
// them to {workforceRoot}/.secrets.json so Aither-Tools can read them.
func (s *Store) ExportSecretsFile(ctx context.Context, workforceID uuid.UUID, workforceRoot string) error {
	rows, err := s.pool.Query(ctx, `
		SELECT service, key_name, value
		FROM workforce_credentials
		WHERE workforce_id = $1
		ORDER BY service, key_name`, workforceID)
	if err != nil {
		return fmt.Errorf("query credentials: %w", err)
	}
	defer rows.Close()

	secrets := make(map[string]map[string]string)
	for rows.Next() {
		var service, keyName, encValue string
		if err := rows.Scan(&service, &keyName, &encValue); err != nil {
			return fmt.Errorf("scan: %w", err)
		}
		plain, err := decrypt(s.encKey, encValue)
		if err != nil {
			return fmt.Errorf("decrypt %s/%s: %w", service, keyName, err)
		}
		if secrets[service] == nil {
			secrets[service] = make(map[string]string)
		}
		secrets[service][keyName] = plain
	}

	data, err := json.MarshalIndent(secrets, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal secrets: %w", err)
	}

	secretsPath := filepath.Join(workforceRoot, ".secrets.json")
	if err := os.MkdirAll(workforceRoot, 0o755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	// 0600 — owner read/write only
	if err := os.WriteFile(secretsPath, data, 0o600); err != nil {
		return fmt.Errorf("write secrets file: %w", err)
	}
	return nil
}

// GetCredentialPlaintext returns the decrypted value of a single credential.
// Used internally; never exposed directly to the API.
func (s *Store) GetCredentialPlaintext(ctx context.Context, workforceID uuid.UUID, service, keyName string) (string, error) {
	var encValue string
	err := s.pool.QueryRow(ctx, `
		SELECT value FROM workforce_credentials
		WHERE workforce_id=$1 AND service=$2 AND key_name=$3`,
		workforceID, service, keyName).Scan(&encValue)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", fmt.Errorf("credential not found")
		}
		return "", fmt.Errorf("get credential: %w", err)
	}
	return decrypt(s.encKey, encValue)
}
