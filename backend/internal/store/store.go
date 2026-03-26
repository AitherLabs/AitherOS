package store

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool   *pgxpool.Pool
	encKey []byte // 32-byte AES-256 key for credential encryption
}

func New(databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &Store{pool: pool}, nil
}

// SetEncryptionKey decodes the base64 ENCRYPTION_KEY env var and stores it.
// Must be called before any credential operations.
func (s *Store) SetEncryptionKey(b64Key string) error {
	key, err := base64.StdEncoding.DecodeString(b64Key)
	if err != nil {
		return fmt.Errorf("decode encryption key: %w", err)
	}
	if len(key) != 32 {
		return fmt.Errorf("encryption key must be 32 bytes, got %d", len(key))
	}
	s.encKey = key
	return nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Pool() *pgxpool.Pool {
	return s.pool
}
