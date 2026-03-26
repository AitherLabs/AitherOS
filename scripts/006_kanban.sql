-- 006_kanban.sql
-- Kanban task board + autonomous mode per workforce

ALTER TABLE workforces
  ADD COLUMN IF NOT EXISTS autonomous_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS heartbeat_interval_m INTEGER NOT NULL DEFAULT 30;

DO $$ BEGIN
  CREATE TYPE kanban_status AS ENUM ('open', 'todo', 'in_progress', 'blocked', 'done');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS kanban_tasks (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workforce_id    UUID         NOT NULL REFERENCES workforces(id) ON DELETE CASCADE,
  title           TEXT         NOT NULL,
  description     TEXT         NOT NULL DEFAULT '',
  status          kanban_status NOT NULL DEFAULT 'open',
  priority        SMALLINT     NOT NULL DEFAULT 1,  -- 0=low 1=normal 2=high 3=urgent
  assigned_to     UUID         REFERENCES agents(id) ON DELETE SET NULL,
  created_by      TEXT         NOT NULL DEFAULT 'human',
  execution_id    UUID         REFERENCES executions(id) ON DELETE SET NULL,
  notes           TEXT         NOT NULL DEFAULT '',
  position        INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kanban_workforce_status
  ON kanban_tasks(workforce_id, status);

CREATE INDEX IF NOT EXISTS idx_kanban_workforce_position
  ON kanban_tasks(workforce_id, status, position);
