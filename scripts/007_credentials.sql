-- 007_credentials.sql
-- Per-workforce credentials store

CREATE TABLE IF NOT EXISTS workforce_credentials (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workforce_id UUID         NOT NULL REFERENCES workforces(id) ON DELETE CASCADE,
  service      TEXT         NOT NULL,   -- e.g. "hackerone", "github", "aws"
  key_name     TEXT         NOT NULL,   -- e.g. "api_key", "username", "token"
  value        TEXT         NOT NULL,   -- AES-256-GCM encrypted, base64 encoded
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(workforce_id, service, key_name)
);

CREATE INDEX IF NOT EXISTS idx_workforce_credentials_workforce
  ON workforce_credentials(workforce_id, service);
