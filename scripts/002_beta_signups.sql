-- Beta Signups — closed beta waitlist entries from the landing page
-- Run after 001_init.sql:
--   psql -U aitheros -d aitheros -f scripts/002_beta_signups.sql

CREATE TABLE IF NOT EXISTS beta_signups (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email      VARCHAR(255) NOT NULL,
    name       VARCHAR(255) NOT NULL DEFAULT '',
    company    VARCHAR(255) NOT NULL DEFAULT '',
    message    TEXT         NOT NULL DEFAULT '',
    status     VARCHAR(20)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS beta_signups_email_idx ON beta_signups (email);
