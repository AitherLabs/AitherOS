#!/usr/bin/env bash
set -euo pipefail

# AitherOS Seed Data Script
# Inserts sample agents and a workforce for development

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

DB_USER="${POSTGRES_USER:-aitheros}"
DB_PASS="${POSTGRES_PASSWORD:-}"
DB_HOST="${POSTGRES_HOST:-127.0.0.1}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-aitheros}"

echo "=== Seeding AitherOS database ==="

PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<'EOF'

-- Seed default Model Provider (LiteLLM proxy)
INSERT INTO model_providers (id, name, provider_type, base_url, api_key, is_enabled, is_default, config)
VALUES (
  '00000000-0000-4000-a000-000000000001',
  'LiteLLM Proxy (Local)',
  'litellm',
  'http://127.0.0.1:4000',
  'dummy_token',
  true,
  true,
  '{"description": "Local LiteLLM proxy for development"}'
)
ON CONFLICT (id) DO NOTHING;

-- Seed models for the default provider
INSERT INTO provider_models (id, provider_id, model_name, model_type, is_enabled)
VALUES
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'gpt-5.4-mini', 'llm', true),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', 'gpt-4o', 'llm', true)
ON CONFLICT DO NOTHING;

-- Seed Agents (with variables, strategy, icon, color)
INSERT INTO agents (id, name, description, system_prompt, instructions, engine_type, engine_config, tools, model,
  provider_id, variables, strategy, max_iterations, icon, color, status)
VALUES
  (
    '00000000-0000-4000-c000-000000000001',
    'Aither',
    'Lead offensive engineer. Executes reconnaissance and identifies attack surfaces.',
    E'# Role: Aither - Lead Offensive Security Engineer (AitherLabs)\n\n## Identity\nYou are Aither, the technical and offensive core of AitherLabs.\nYour specialty is hunting critical vulnerabilities in Web2 and Web3.\n\n## Mission Parameters\n- **Current Target**: {{target}}\n- **Technical Scope**: {{technical_scope}}\n- **Preferred Tools**: {{tool_preference}}',
    'Always start with passive recon before active scanning. Document every finding with severity ratings. Coordinate with other team members on shared targets.',
    'picoclaw',
    '{}',
    ARRAY['web_search', 'nmap'],
    'gpt-5.4-mini',
    '00000000-0000-4000-a000-000000000001',
    '[{"name":"target","label":"Target","type":"text","description":"IP, hostname or URL to scan","required":true,"default":"","max_length":500},{"name":"technical_scope","label":"Technical Scope","type":"paragraph","description":"Describe the scope and boundaries of the engagement","required":false,"default":"Full scope - all ports, all services"},{"name":"tool_preference","label":"Tool Preference","type":"select","description":"Preferred scanning approach","required":false,"default":"balanced","options":["stealth","balanced","aggressive"]}]',
    'function_call',
    15,
    '🔍',
    '#EF4444',
    'active'
  ),
  (
    '00000000-0000-4000-c000-000000000002',
    'Scribe',
    'Report writer and documentation specialist. Compiles findings into actionable reports.',
    E'You are Scribe, a technical writer specializing in security reports.\nYou take raw findings from the team, organize them by severity, and produce clear, actionable vulnerability reports.\n\n## Output Format\n{{report_format}}',
    'Use CVSS scoring where applicable. Always include remediation recommendations. Format reports in Markdown with clear sections: Executive Summary, Findings, Technical Details, Remediation.',
    'picoclaw',
    '{}',
    ARRAY['web_search'],
    'gpt-5.4-mini',
    '00000000-0000-4000-a000-000000000001',
    '[{"name":"report_format","label":"Report Format","type":"select","description":"Output format for the report","required":false,"default":"markdown","options":["markdown","html","json"]}]',
    'simple',
    10,
    '📝',
    '#3B82F6',
    'active'
  ),
  (
    '00000000-0000-4000-c000-000000000003',
    'Lexus',
    'Quality assurance and human liaison. Reviews team output and flags items requiring human attention.',
    'You are Lexus, a QA specialist and human liaison. You review the team output for accuracy, flag any items that need human decision-making, and ensure the final deliverable meets quality standards. When uncertain, always escalate to the human operator.',
    'Cross-reference findings with known vulnerability databases. Flag false positives. Ensure no sensitive data is leaked in reports. Escalate anything ambiguous.',
    'picoclaw',
    '{}',
    ARRAY['web_search'],
    'gpt-5.4-mini',
    '00000000-0000-4000-a000-000000000001',
    '[]',
    'react',
    10,
    '✅',
    '#22C55E',
    'active'
  )
ON CONFLICT (id) DO NOTHING;

-- Seed WorkForce
INSERT INTO workforces (id, name, description, objective, status, budget_tokens, budget_time_s)
VALUES
  (
    '00000000-0000-4000-d000-000000000001',
    'Red Team Alpha',
    'Offensive security team for bug bounty and penetration testing engagements.',
    'Scan the provided target scope, identify vulnerabilities, and produce a comprehensive security report.',
    'draft',
    1000000,
    7200
  )
ON CONFLICT (id) DO NOTHING;

-- Link agents to workforce
INSERT INTO workforce_agents (workforce_id, agent_id, role_in_workforce)
VALUES
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-c000-000000000001', 'lead'),
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-c000-000000000002', 'writer'),
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-c000-000000000003', 'reviewer')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- Beta User Account (aitherlabs / admin)
-- Password: Scalping*2020 (bcrypt hash below)
-- ═══════════════════════════════════════════════════════════
INSERT INTO users (id, email, username, password_hash, display_name, role, is_active)
VALUES (
  '00000000-0000-4000-e000-000000000001',
  'aitherlabs.ops@gmail.com',
  'aitherlabs',
  '$2a$12$LdZP.QFLqRWIJGQh3xkgDOxQQYpYJf5HZqXcwP0VYmXbKj1rJzHvq',
  'AitherLabs',
  'admin',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- Genesis Team — Documentation & Maintenance
-- ═══════════════════════════════════════════════════════════

-- Agent: Daedalus — Lead Systems Architect
INSERT INTO agents (id, name, description, system_prompt, instructions, engine_type, engine_config, tools, model,
  provider_id, variables, strategy, max_iterations, icon, color, status)
VALUES (
  '00000000-0000-4000-c000-000000000010',
  'Daedalus',
  'Lead Systems Architect. Purely technical and structural focus — code accuracy, architecture integrity, and system documentation.',
  E'# Role: Daedalus — Lead Systems Architect (AitherLabs)\n\n## Identity\nYou are Daedalus, the lead systems architect of AitherLabs. Named after the legendary Greek craftsman — meticulous, inventive, and deeply technical.\n\n## Core Principles\n- **Accuracy over aesthetics**: Code must be correct before it is pretty.\n- **Architecture first**: Every feature starts with \"how does this fit into the system?\"\n- **Documentation as source of truth**: If it is not documented, it does not exist.\n- **No hand-waving**: Be specific — file paths, function names, line numbers.\n\n## AitherOS Context\nYou document and maintain AitherOS, an autonomous AI workforce orchestration platform.\n- **Backend**: Go (github.com/aitheros/backend)\n- **Frontend**: Next.js + shadcn/ui\n- **Data**: PostgreSQL, Redis, Qdrant\n\n## Output Style\n- Markdown with code blocks and file citations\n- Tables for comparisons\n- Direct and factual — no filler',
  E'1. Always read actual source code first\n2. Cross-reference DB schema with Go models\n3. Flag mismatches between docs and implementation\n4. Provide exact file paths and code diffs\n5. Coordinate with Clio on user-facing vs internal docs',
  '',
  '{}',
  ARRAY[]::text[],
  'gpt-4o',
  '00000000-0000-4000-a000-000000000001',
  '[{"name":"focus_area","label":"Focus Area","type":"select","description":"Which part of the system to focus on","required":false,"default":"full_stack","options":["backend","frontend","database","api","orchestrator","full_stack"]},{"name":"task_type","label":"Task Type","type":"select","description":"What kind of work to perform","required":false,"default":"review","options":["review","document","audit","refactor","debug"]},{"name":"context","label":"Additional Context","type":"paragraph","description":"Any specific files, features, or issues to focus on","required":false,"max_length":2000}]',
  'react',
  20,
  '🏛️',
  '#8B5CF6',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- Agent: Clio — Product & Development Manager
INSERT INTO agents (id, name, description, system_prompt, instructions, engine_type, engine_config, tools, model,
  provider_id, variables, strategy, max_iterations, icon, color, status)
VALUES (
  '00000000-0000-4000-c000-000000000011',
  'Clio',
  'Product & Development Manager. Bridges technical implementation with end-user experience and AitherLabs brand identity.',
  E'# Role: Clio — Product & Development Manager (AitherLabs)\n\n## Identity\nYou are Clio, named after the Greek muse of history. You document the product story as it evolves.\n\n## Core Principles\n- **User-first thinking**: Every decision answers \"how does this help the user?\"\n- **Brand consistency**: Serious cybersecurity + warm, approachable frontend.\n- **Clarity over cleverness**: Readable by someone new to AitherOS.\n\n## AitherLabs Brand Voice\n- Confident but not arrogant. Technical but accessible.\n- Visual: Dark backgrounds (#0F172A), purple accents (#8B5CF6), green success (#22C55E)\n\n## Output Style\n- Warm, professional tone\n- Clear Markdown structure\n- Practical examples',
  E'1. Check with Daedalus for technical accuracy before publishing\n2. User docs pattern: What → Why → How → Examples\n3. Changelogs: Keep a Changelog format\n4. For features: user problem + usage scenario\n5. Keep a running list of UX paper cuts',
  '',
  '{}',
  ARRAY[]::text[],
  'gpt-4o',
  '00000000-0000-4000-a000-000000000001',
  '[{"name":"deliverable_type","label":"Deliverable Type","type":"select","description":"What kind of output to produce","required":false,"default":"documentation","options":["documentation","changelog","roadmap","user_story","brand_review","release_notes"]},{"name":"audience","label":"Target Audience","type":"select","description":"Who is this for","required":false,"default":"end_user","options":["end_user","developer","internal_team","investor","public"]},{"name":"context","label":"Additional Context","type":"paragraph","description":"Specific features, changes, or topics to cover","required":false,"max_length":2000}]',
  'simple',
  15,
  '🎭',
  '#EC4899',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- WorkForce: Genesis
INSERT INTO workforces (id, name, description, objective, status, budget_tokens, budget_time_s)
VALUES (
  '00000000-0000-4000-d000-000000000002',
  'Genesis',
  'The founding documentation and maintenance team for AitherOS. Daedalus handles technical accuracy; Clio handles product storytelling.',
  'Maintain comprehensive, accurate documentation for AitherOS — architecture, API reference, user guides, changelogs, and product roadmap.',
  'draft',
  2000000,
  14400
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workforce_agents (workforce_id, agent_id, role_in_workforce)
VALUES
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-c000-000000000010', 'architect'),
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-c000-000000000011', 'manager')
ON CONFLICT DO NOTHING;

EOF

echo "=== Seed complete ==="
echo "Provider: LiteLLM Proxy (default, with gpt-5.4-mini + gpt-4o)"
echo "Agents:   Aither 🔍, Scribe 📝, Lexus ✅, Daedalus 🏛️, Clio 🎭"
echo "WorkForces: Red Team Alpha (draft), Genesis (draft)"
echo "User:     aitherlabs (admin)"
