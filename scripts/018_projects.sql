-- 018_projects.sql
-- Projects / Epics: group kanban tasks, executions, and knowledge by project

CREATE TABLE IF NOT EXISTS projects (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workforce_id UUID         NOT NULL REFERENCES workforces(id) ON DELETE CASCADE,
  name         TEXT         NOT NULL,
  description  TEXT         NOT NULL DEFAULT '',
  status       TEXT         NOT NULL DEFAULT 'active', -- active | paused | completed | archived
  icon         TEXT         NOT NULL DEFAULT '📁',
  color        TEXT         NOT NULL DEFAULT '#9A66FF',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_workforce_id ON projects(workforce_id);

-- Wire existing tables to projects
ALTER TABLE kanban_tasks
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kanban_project_id    ON kanban_tasks(project_id)      WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_executions_project_id ON executions(project_id)       WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_project_id  ON knowledge_entries(project_id) WHERE project_id IS NOT NULL;
